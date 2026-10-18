import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Keeps social account tokens encrypted at rest, and signs the state passed
// through Meta's and TikTok's sign-in pages so the callback knows which shop
// it's for. Both keyed from the app's Shopify secret.

const secret = () => process.env.SHOPIFY_API_SECRET || "dev";
const key = () => createHash("sha256").update(`social-tokens:${secret()}`).digest();

export function seal(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string) {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const sign = (body: string) => createHmac("sha256", secret()).update(`social-state:${body}`).digest("base64url");

export type State = { shop: string; network: string; exp: number };

export function signState(state: State) {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${sign(body)}`;
}

// The state, when it's ours and not expired.
export function readState(token: string, now = Date.now()): State | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as State;
    return typeof state.shop === "string" && typeof state.network === "string" && state.exp > now ? state : null;
  } catch {
    return null;
  }
}
