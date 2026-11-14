import { createPublicKey, randomBytes, verify, type webcrypto } from "node:crypto";

type JsonWebKey = webcrypto.JsonWebKey;
import db from "../../db.server";
import { postImages, uploadSocialImage } from "./publishing.server";
import { pkceChallenge, pkceVerifier, seal, signState, unseal } from "./seal.server";
import type { Fetch } from "./networks.server";

// Canva: the merchant connects their Canva account, starts a design at a
// post's size, and brings its pages back as the post's pictures. Off until
// CANVA_CLIENT_ID and CANVA_CLIENT_SECRET are set.

const API = "https://api.canva.com/rest/v1";
const SCOPES = ["design:content:read", "design:content:write", "design:meta:read", "profile:read"];
const SIGN_IN_FOR = 30 * 60_000;

export const canvaOn = () => !!(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET);
const redirectUri = () => `${process.env.SHOPIFY_APP_URL || ""}/social/callback/canva`;

export function canvaAuthorizeUrl(shop: string, now = Date.now()) {
  const state = signState({ shop, network: "canva", exp: now + SIGN_IN_FOR });
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.CANVA_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    scope: SCOPES.join(" "),
    state,
    code_challenge: pkceChallenge(pkceVerifier(state)),
    code_challenge_method: "S256",
  });
  return `https://www.canva.com/api/oauth/authorize?${q}`;
}

type Token = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string; message?: string };

async function canvaToken(f: Fetch, params: Record<string, string>, now: Date) {
  const basic = Buffer.from(`${process.env.CANVA_CLIENT_ID ?? ""}:${process.env.CANVA_CLIENT_SECRET ?? ""}`).toString("base64");
  const res = await f(`${API}/oauth/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Token;
  if (!res.ok || !json.access_token || !json.refresh_token) throw new Error(json.error_description || json.message || json.error || `Canva answered ${res.status}`);
  return { token: json.access_token, refreshToken: json.refresh_token, expiresAt: new Date(now.getTime() + (json.expires_in ?? 14400) * 1000) };
}

async function canva<T>(f: Fetch, token: string, path: string, body?: object): Promise<T> {
  const res = await f(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(json.message || `Canva answered ${res.status}`);
  return json;
}

// Finishes signing in: swaps the code for tokens and saves them for the shop.
export async function connectCanva(shop: string, code: string, state: string, f: Fetch = fetch, now = new Date()) {
  const t = await canvaToken(f, { grant_type: "authorization_code", code, code_verifier: pkceVerifier(state), redirect_uri: redirectUri() }, now);
  const me = await canva<{ profile?: { display_name?: string } }>(f, t.token, "/users/me/profile").catch(() => ({ profile: undefined }));
  const name = (me.profile?.display_name || "Canva account").slice(0, 200);
  const data = { name, token: seal(t.token), refreshToken: seal(t.refreshToken), tokenExpiresAt: t.expiresAt };
  await db.canvaConnection.upsert({ where: { shop }, update: data, create: { shop, ...data } });
  return name;
}

export async function canvaAccount(shop: string) {
  const c = await db.canvaConnection.findUnique({ where: { shop } });
  return c ? { name: c.name } : null;
}

export async function disconnectCanva(shop: string) {
  await db.canvaConnection.deleteMany({ where: { shop } });
}

// A working token, refreshed when it's within five minutes of running out.
// Canva's refresh tokens work once, so the new one is saved straight away.
async function liveCanvaToken(shop: string, f: Fetch, now: Date) {
  const c = await db.canvaConnection.findUnique({ where: { shop } });
  if (!c) throw new Error("Connect Canva first.");
  if (c.tokenExpiresAt.getTime() > now.getTime() + 5 * 60_000) return unseal(c.token);
  const t = await canvaToken(f, { grant_type: "refresh_token", refresh_token: unseal(c.refreshToken) }, now).catch((err) => {
    throw new Error(`Connect Canva again (${err instanceof Error ? err.message : String(err)}).`);
  });
  await db.canvaConnection.update({ where: { shop }, data: { token: seal(t.token), refreshToken: seal(t.refreshToken), tokenExpiresAt: t.expiresAt } });
  return t.token;
}

// The sizes a design can start at, one for each kind of post.
export const CANVA_SIZES = {
  square: { label: "Square post (1080 × 1080)", width: 1080, height: 1080 },
  portrait: { label: "Portrait post (1080 × 1350)", width: 1080, height: 1350 },
  pin: { label: "Pinterest pin (1000 × 1500)", width: 1000, height: 1500 },
  story: { label: "Story or TikTok (1080 × 1920)", width: 1080, height: 1920 },
  wide: { label: "Facebook landscape (1200 × 630)", width: 1200, height: 630 },
} as const;
export type CanvaSize = keyof typeof CANVA_SIZES;

// A new, empty design at the size, and the link that opens it in Canva.
export async function newCanvaDesign(shop: string, size: string, title: string, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}) {
  const s = CANVA_SIZES[size as CanvaSize];
  if (!s) return { error: "Choose a size for the design." };
  try {
    const token = await liveCanvaToken(shop, f, now);
    const made = await canva<{ design?: { id: string; urls?: { edit_url?: string } } }>(f, token, "/designs", {
      design_type: { type: "custom", width: s.width, height: s.height },
      title: (title.trim() || "Social post").slice(0, 255),
    });
    if (!made.design?.urls?.edit_url) return { error: "Canva didn't send a link to the design." };
    // Canva hands this back with the design when the merchant presses its
    // return button, so the design lands in the post they were writing.
    const back = randomBytes(18).toString("base64url");
    await db.canvaReturn.create({ data: { token: back, shop } });
    const edit = new URL(made.design.urls.edit_url);
    edit.searchParams.set("correlation_state", back);
    return { editUrl: edit.toString(), token: back };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Opens a design that's already in a post, to change it. Canva's return
// button brings the new version back in place of the old pictures.
export async function editCanvaDesign(shop: string, designId: string, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}) {
  if (!/^[\w-]{1,64}$/.test(designId)) return { error: "Choose a design." };
  try {
    const token = await liveCanvaToken(shop, f, now);
    const got = await canva<{ design?: { id: string; urls?: { edit_url?: string } } }>(f, token, `/designs/${encodeURIComponent(designId)}`);
    if (!got.design?.urls?.edit_url) return { error: "Canva didn't send a link to the design. It may have been deleted." };
    const back = randomBytes(18).toString("base64url");
    await db.canvaReturn.create({ data: { token: back, shop } });
    const edit = new URL(got.design.urls.edit_url);
    edit.searchParams.set("correlation_state", back);
    return { editUrl: edit.toString(), token: back, replace: designId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export type CanvaDesign = { id: string; title: string; thumbnail: string | null; pages: number | null; updatedAt: string | null };

// The merchant's most recently changed designs, to bring one in.
export async function recentCanvaDesigns(shop: string, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}) {
  try {
    const token = await liveCanvaToken(shop, f, now);
    const list = await canva<{ items?: { id: string; title?: string; thumbnail?: { url?: string }; page_count?: number; updated_at?: number }[] }>(
      f,
      token,
      "/designs?sort_by=modified_descending&ownership=owned",
    );
    const designs: CanvaDesign[] = (list.items ?? []).slice(0, 18).map((d) => ({
      id: d.id,
      title: d.title || "Untitled design",
      thumbnail: d.thumbnail?.url ?? null,
      pages: d.page_count ?? null,
      updatedAt: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : null,
    }));
    return { designs };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Exports the design, one picture a page, and stores each as a picture for a
// post. Canva exports in the background, so this waits for it, up to a minute.
export async function importCanvaDesign(
  shop: string,
  designId: string,
  max: number,
  { f = fetch, now = new Date(), pause = wait }: { f?: Fetch; now?: Date; pause?: (ms: number) => Promise<unknown> } = {},
) {
  if (!/^[\w-]{1,64}$/.test(designId)) return { error: "Choose a design." };
  try {
    const token = await liveCanvaToken(shop, f, now);
    let job = (await canva<{ job: { id: string; status: string; urls?: string[]; error?: { message?: string } } }>(f, token, "/exports", { design_id: designId, format: { type: "png" } })).job;
    for (let i = 0; i < 30 && job.status === "in_progress"; i++) {
      await pause(2000);
      job = (await canva<{ job: typeof job }>(f, token, `/exports/${encodeURIComponent(job.id)}`)).job;
    }
    if (job.status !== "success" || !job.urls?.length) return { error: job.error?.message ? `Canva said: ${job.error.message}` : "Canva is still exporting the design. Try again in a minute." };
    const images: { id: string; url: string; canva: string }[] = [];
    for (const url of job.urls.slice(0, Math.max(0, max))) {
      const res = await f(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) continue;
      const data = await res.arrayBuffer();
      const up = await uploadSocialImage(shop, { type: "image/png", size: data.byteLength, arrayBuffer: async () => data });
      if (!("imageId" in up) || !up.imageId) continue;
      await db.socialImage.update({ where: { id: up.imageId }, data: { canvaDesignId: designId } });
      images.push({ id: up.imageId, url: up.url, canva: designId });
    }
    if (!images.length) return { error: "Couldn't bring the design's pages in from Canva. Try again." };
    return { images, more: job.urls.length > images.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Canva's return button: Canva sends the merchant to /canva/return with a
// JWT it signed, holding the correlation_state we gave it and the design.
let keys: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

async function canvaKeys(f: Fetch, now: number, fresh = false) {
  if (!fresh && keys && now - keys.at < 3600_000) return keys.keys;
  const res = await f(`${API}/connect/keys`, { signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as { keys?: (JsonWebKey & { kid?: string })[] };
  if (!res.ok || !json.keys?.length) throw new Error("Couldn't check Canva's signature.");
  keys = { at: now, keys: json.keys };
  return json.keys;
}

export async function readCanvaReturn(jwt: string, f: Fetch = fetch, now = Date.now()) {
  const [h, p, sig] = jwt.split(".");
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
    // Canva signs with Ed25519 (EdDSA); RS256 is still accepted in case it switches.
    const algo = header.alg === "EdDSA" ? null : header.alg === "RS256" ? "RSA-SHA256" : undefined;
    if (algo === undefined) return null;
    let key = (await canvaKeys(f, now)).find((k) => k.kid === header.kid);
    // Canva may have started signing with a new key since the list was read.
    if (!key) key = (await canvaKeys(f, now, true)).find((k) => k.kid === header.kid);
    if (!key) return null;
    const ok = verify(algo, Buffer.from(`${h}.${p}`), createPublicKey({ key, format: "jwk" }), Buffer.from(sig, "base64url"));
    if (!ok) return null;
    // Canva's signature, plus the one-off correlation_state only we hand out,
    // is what proves the return is real.
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { exp?: number; correlation_state?: string; design_id?: string };
    if (claims.exp && claims.exp * 1000 < now) return null;
    if (!claims.correlation_state || !claims.design_id) return null;
    return { token: claims.correlation_state, designId: claims.design_id };
  } catch {
    return null;
  }
}

const RETURN_FOR = 24 * 3600_000;

// Brings the design in for the post that started it.
export async function finishCanvaReturn(jwt: string, { f = fetch, now = new Date(), pause = wait }: { f?: Fetch; now?: Date; pause?: (ms: number) => Promise<unknown> } = {}) {
  const back = await readCanvaReturn(jwt, f, now.getTime());
  if (!back) return { error: "This link from Canva isn't valid. Go back to SimilarWise and press Add from Canva instead." };
  const row = await db.canvaReturn.findUnique({ where: { token: back.token } });
  if (!row || now.getTime() - row.createdAt.getTime() > RETURN_FOR)
    return { error: "This design was started too long ago to bring in this way. Go back to SimilarWise and press Add from Canva instead." };
  if (row.status === "ready") return { ok: true as const, pages: postImages({ imageId: null, imageIds: row.imageIds }).length };
  const res = await importCanvaDesign(row.shop, back.designId, 10, { f, now, pause });
  if ("error" in res && res.error) {
    await db.canvaReturn.update({ where: { token: row.token }, data: { status: "failed", error: res.error.slice(0, 300) } });
    return { error: res.error };
  }
  const ids = "images" in res && res.images ? res.images.map((i) => i.id) : [];
  await db.canvaReturn.update({ where: { token: row.token }, data: { status: "ready", imageIds: JSON.stringify(ids) } });
  return { ok: true as const, pages: ids.length };
}

// What the composer sees while it waits: the pictures once they're in. Each
// set is handed over once.
export async function takeCanvaReturn(shop: string, token: string) {
  const row = await db.canvaReturn.findFirst({ where: { token, shop } });
  if (!row) return { status: "gone" as const };
  if (row.status === "waiting") return { status: "waiting" as const };
  await db.canvaReturn.delete({ where: { token } });
  if (row.status === "failed") return { status: "failed" as const, error: row.error ?? "Couldn't bring the design in from Canva." };
  const ids = postImages({ imageId: null, imageIds: row.imageIds });
  const from = new Map((await db.socialImage.findMany({ where: { shop, id: { in: ids } }, select: { id: true, canvaDesignId: true } })).map((i) => [i.id, i.canvaDesignId]));
  return { status: "ready" as const, images: ids.map((id) => ({ id, url: `/social-images/${id}.jpg`, canva: from.get(id) ?? null })) };
}
