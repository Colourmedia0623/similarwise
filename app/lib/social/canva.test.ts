import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import db from "../../db.server";
import { canvaAccount, canvaAuthorizeUrl, connectCanva, importCanvaDesign, newCanvaDesign, recentCanvaDesigns } from "./canva.server";
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
    expect(await newCanvaDesign(SHOP, "portrait", "Autumn candles", { f, now: later })).toEqual({ editUrl: "https://www.canva.com/design/D1/edit" });
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
});
