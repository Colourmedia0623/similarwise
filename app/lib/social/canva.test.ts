import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import db from "../../db.server";
import { generateKeyPairSync, sign } from "node:crypto";
import { canvaAccount, canvaAuthorizeUrl, connectCanva, editCanvaDesign, finishCanvaReturn, importCanvaDesign, newCanvaDesign, recentCanvaDesigns, takeCanvaReturn } from "./canva.server";
import type { Fetch } from "./networks.server";
import { pkceChallenge, pkceVerifier, unseal } from "./seal.server";

const SHOP = "canva.myshopify.com";
const NOW = new Date("2026-11-13T10:00:00Z");

type Call = { url: string; body: string; auth: string | null };
function fakeFetch(routes: [RegExp, (call: Call) => unknown][], calls: Call[]): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: String(init?.body ?? ""), auth: new Headers(init?.headers).get("authorization") };
    calls.push(call);
    const hit = routes.find(([re]) => re.test(call.url));
    const out = hit ? hit[1](call) : { message: `unexpected ${call.url}` };
    if (out instanceof Uint8Array) return new Response(new Blob([out as BlobPart]), { status: 200 });
    return new Response(JSON.stringify(out), { status: hit ? 200 : 400 });
  }) as Fetch;
}

describe("Canva", () => {
  beforeEach(async () => {
    process.env.CANVA_CLIENT_ID = "canva-id";
    process.env.CANVA_CLIENT_SECRET = "canva-secret";
    await db.canvaConnection.deleteMany({ where: { shop: SHOP } });
    await db.socialImage.deleteMany({ where: { shop: SHOP } });
    await db.canvaReturn.deleteMany({ where: { shop: SHOP } });
  });

  async function connect() {
    const url = new URL(canvaAuthorizeUrl(SHOP, NOW.getTime()));
    const state = url.searchParams.get("state")!;
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/oauth\/token/, () => ({ access_token: "t1", refresh_token: "r1", expires_in: 14400 })],
        [/users\/me\/profile/, () => ({ profile: { display_name: "Chris" } })],
      ],
      calls,
    );
    await connectCanva(SHOP, "code1", state, f, NOW);
    return { url, state, calls };
  }

  it("signs in with PKCE and keeps the tokens sealed", async () => {
    const { url, state, calls } = await connect();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(pkceVerifier(state)));
    expect(url.searchParams.get("scope")).toContain("design:content:write");
    const token = new URLSearchParams(calls[0].body);
    expect(token.get("code_verifier")).toBe(pkceVerifier(state));
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("canva-id:canva-secret").toString("base64")}`);
    const row = await db.canvaConnection.findUniqueOrThrow({ where: { shop: SHOP } });
    expect(row.token).not.toBe("t1");
    expect(unseal(row.token)).toBe("t1");
    expect(await canvaAccount(SHOP)).toEqual({ name: "Chris" });
  });

  it("starts a design at the post's size, refreshing an old token once", async () => {
    await connect();
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/oauth\/token/, () => ({ access_token: "t2", refresh_token: "r2", expires_in: 14400 })],
        [/\/designs$/, () => ({ design: { id: "D1", urls: { edit_url: "https://www.canva.com/design/D1/edit" } } })],
      ],
      calls,
    );
    const later = new Date(NOW.getTime() + 4 * 3600_000);
    expect(await newCanvaDesign(SHOP, "portrait", "Autumn candles", { f, now: later })).toMatchObject({ editUrl: expect.stringMatching(/^https:\/\/www\.canva\.com\/design\/D1\/edit\?correlation_state=/) });
    expect(new URLSearchParams(calls[0].body).get("refresh_token")).toBe("r1");
    expect(JSON.parse(calls[1].body)).toEqual({ design_type: { type: "custom", width: 1080, height: 1350 }, title: "Autumn candles" });
    expect(calls[1].auth).toBe("Bearer t2");
    expect(unseal((await db.canvaConnection.findUniqueOrThrow({ where: { shop: SHOP } })).refreshToken)).toBe("r2");
    expect(await newCanvaDesign(SHOP, "huge", "x", { f, now: later })).toEqual({ error: "Choose a size for the design." });
  });

  it("brings a design's pages in as pictures, waiting for the export", async () => {
    await connect();
    const png = new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#7d2ae8" } }).png().toBuffer());
    let checks = 0;
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/\/designs\?/, () => ({ items: [{ id: "D1", title: "Autumn", thumbnail: { url: "https://t/1.png" }, page_count: 3 }] })],
        [/\/exports$/, () => ({ job: { id: "E1", status: "in_progress" } })],
        [/\/exports\/E1$/, () => (++checks < 2 ? { job: { id: "E1", status: "in_progress" } } : { job: { id: "E1", status: "success", urls: ["https://x/1.png", "https://x/2.png", "https://x/3.png"] } })],
        [/https:\/\/x\//, () => png],
      ],
      calls,
    );
    expect(await recentCanvaDesigns(SHOP, { f, now: NOW })).toMatchObject({ designs: [{ id: "D1", title: "Autumn", pages: 3 }] });
    const res = await importCanvaDesign(SHOP, "D1", 2, { f, now: NOW, pause: async () => {} });
    expect(res).toMatchObject({ more: true });
    expect("images" in res && res.images).toHaveLength(2);
    expect(JSON.parse(calls.find((c) => /\/exports$/.test(c.url))!.body)).toEqual({ design_id: "D1", format: { type: "png" } });
    expect(await db.socialImage.count({ where: { shop: SHOP } })).toBe(2);
    expect(await importCanvaDesign(SHOP, "../x", 2, { f, now: NOW })).toEqual({ error: "Choose a design." });
  });

  it("brings a design back with Canva's return button, for the post that started it", async () => {
    await connect();
    // Canva signs its return links with Ed25519 (EdDSA).
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const kid = `k${Date.now()}`;
    const jwk = { ...publicKey.export({ format: "jwk" }), kid };
    const jwt = (claims: object, key = privateKey) => {
      const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const body = `${b({ alg: "EdDSA", kid })}.${b(claims)}`;
      return `${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`;
    };
    const png = new Uint8Array(await sharp({ create: { width: 200, height: 300, channels: 3, background: "#123456" } }).png().toBuffer());
    const f = fakeFetch(
      [
        [/\/designs$/, () => ({ design: { id: "D7", urls: { edit_url: "https://www.canva.com/design/D7/edit?ui=1" } } })],
        [/connect\/keys/, () => ({ keys: [jwk] })],
        [/\/exports$/, () => ({ job: { id: "E7", status: "success", urls: ["https://x/1.png", "https://x/2.png"] } })],
        [/https:\/\/x\//, () => png],
      ],
      [],
    );
    const made = (await newCanvaDesign(SHOP, "square", "Gifts", { f, now: NOW })) as { editUrl: string; token: string };
    expect(new URL(made.editUrl).searchParams.get("correlation_state")).toBe(made.token);
    expect(made.token.length).toBeLessThanOrEqual(50);
    expect(await takeCanvaReturn(SHOP, made.token)).toEqual({ status: "waiting" });
    // A forged return is turned away.
    const forged = jwt({ correlation_state: made.token, design_id: "D7", exp: NOW.getTime() / 1000 + 600 }, generateKeyPairSync("ed25519").privateKey);
    expect(await finishCanvaReturn(forged, { f, now: NOW })).toMatchObject({ error: expect.stringMatching(/isn't valid/) });
    const real = jwt({ correlation_state: made.token, design_id: "D7", aud: "canva-id", exp: NOW.getTime() / 1000 + 600 });
    expect(await finishCanvaReturn(real, { f, now: NOW, pause: async () => {} })).toEqual({ ok: true, pages: 2 });
    expect(await takeCanvaReturn("other.myshopify.com", made.token)).toEqual({ status: "gone" });
    const taken = await takeCanvaReturn(SHOP, made.token);
    expect(taken.status).toBe("ready");
    expect("images" in taken && taken.images).toHaveLength(2);
    expect(await takeCanvaReturn(SHOP, made.token)).toEqual({ status: "gone" });
    // The pictures remember their design, so it can be opened again and changed.
    expect("images" in taken && taken.images?.every((i) => i.canva === "D7")).toBe(true);
    const g = fakeFetch([[/\/designs\/D7$/, () => ({ design: { id: "D7", urls: { edit_url: "https://www.canva.com/design/D7/edit?ui=2" } } })]], []);
    const again = (await editCanvaDesign(SHOP, "D7", { f: g, now: NOW })) as { editUrl: string; token: string; replace: string };
    expect(again.replace).toBe("D7");
    expect(new URL(again.editUrl).searchParams.get("correlation_state")).toBe(again.token);
    expect(await takeCanvaReturn(SHOP, again.token)).toEqual({ status: "waiting" });
    expect(await editCanvaDesign(SHOP, "../x", { f: g, now: NOW })).toEqual({ error: "Choose a design." });
  });
});
