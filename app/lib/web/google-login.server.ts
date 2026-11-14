import { randomBytes } from "node:crypto";
import db from "../../db.server";
import { readState, signState } from "../social/seal.server";

// "Continue with Google" on the website, using the same Google client as the
// Google Analytics connection. Needs {APP_URL}/login/google/callback added as
// an authorised redirect URI on that client.

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const NONCE_COOKIE = "sw_google";

export const googleLoginOn = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const callbackUrl = () => `${process.env.SHOPIFY_APP_URL || ""}/login/google/callback`;
const secure = () => ((process.env.SHOPIFY_APP_URL ?? "").startsWith("https://") ? "; Secure" : "");

// Where to send the browser, and the cookie that ties the answer to this browser.
export function googleLoginStart(intent: "login" | "signup", next: string) {
  const nonce = randomBytes(16).toString("base64url");
  // The state's shop field carries this browser's nonce, the intent and where to go after.
  const state = signState({ shop: JSON.stringify({ nonce, intent, next }), network: "google-login", exp: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state,
  });
  return { url: `${AUTH}?${q}`, cookie: `${NONCE_COOKIE}=${nonce}; Path=/login/google; HttpOnly; SameSite=Lax; Max-Age=600${secure()}` };
}

export const clearGoogleCookie = () => `${NONCE_COOKIE}=; Path=/login/google; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

type Profile = { sub: string; email: string; name: string | null };

// Checks the answer from Google and reads who signed in.
export async function googleLoginFinish(request: Request, f: typeof fetch = fetch): Promise<{ profile: Profile; intent: "login" | "signup"; next: string } | { error: string }> {
  const url = new URL(request.url);
  const state = readState(url.searchParams.get("state") ?? "");
  if (!state || state.network !== "google-login") return { error: "That sign-in took too long. Please try again." };
  let parsed: { nonce: string; intent: "login" | "signup"; next: string };
  try {
    parsed = JSON.parse(state.shop);
  } catch {
    return { error: "That sign-in didn't work. Please try again." };
  }
  const cookieNonce = (request.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${NONCE_COOKIE}=`))?.slice(NONCE_COOKIE.length + 1);
  if (!cookieNonce || cookieNonce !== parsed.nonce) return { error: "That sign-in started in another browser. Please try again here." };
  const code = url.searchParams.get("code");
  if (!code) return { error: "You didn't finish signing in with Google." };
  const res = await f(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string };
  if (!res.ok || !json.id_token) return { error: `Google didn't sign you in: ${json.error_description ?? res.status}` };
  // Straight from Google's token endpoint over HTTPS, so its signature needn't be checked again (OpenID Connect 3.1.3.7).
  const claims = JSON.parse(Buffer.from(json.id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    aud?: string;
  };
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID || !claims.sub || !claims.email) return { error: "Google didn't share your email address." };
  if (!claims.email_verified) return { error: "Your Google account's email address isn't verified yet." };
  return { profile: { sub: claims.sub, email: claims.email.toLowerCase(), name: claims.name ?? null }, intent: parsed.intent, next: parsed.next };
}

// The user for a Google profile: found by Google ID, then by email (linking
// the two), else null for a new person.
export async function userForGoogle(p: Profile) {
  const byId = await db.webUser.findUnique({ where: { googleId: p.sub } });
  if (byId) return byId;
  const byEmail = await db.webUser.findUnique({ where: { email: p.email } });
  if (byEmail) return db.webUser.update({ where: { id: byEmail.id }, data: { googleId: p.sub, name: byEmail.name ?? p.name } });
  return null;
}
