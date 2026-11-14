import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import db from "../../db.server";
import { TRIAL_DAYS } from "../billing";
import { newWebShop } from "./shop";

// Logins for the standalone web version: email and password or Google, a
// cookie per signed-in browser, and the workspace each browser is looking at.
// Shopify installs never come through here: Shopify admin sends its own
// session token and never the website's cookie (see isShopifyRequest).

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const COOKIE = "sw_session";
const SESSION_DAYS = 30;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const secure = () => (process.env.SHOPIFY_APP_URL ?? "").startsWith("https://");

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const [kind, salt, hash] = (stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await scrypt(password, Buffer.from(salt, "base64url"), want.length);
  return timingSafeEqual(want, got);
}

export const passwordProblem = (pw: string) =>
  pw.length < 8 ? "Use at least 8 characters for your password." : pw.length > 200 ? "That password is too long." : null;

// Requests from inside Shopify admin: App Bridge adds a session token to every
// fetch, and the first page load carries the shop and an id_token. These always
// go to Shopify's own login, even if the browser also has a website cookie.
export function isShopifyRequest(request: Request) {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return true;
  const q = new URL(request.url).searchParams;
  return ["shop", "host", "id_token", "embedded", "hmac", "session"].some((k) => q.has(k));
}

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

const cookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? "; Secure" : ""}`;

// Starts a signed-in session; returns the Set-Cookie header.
export async function startSession(userId: string, workspaceId: string | null) {
  const token = randomBytes(32).toString("base64url");
  await db.webSession.create({
    data: { id: sha256(token), userId, workspaceId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) },
  });
  return cookie(token, SESSION_DAYS * 86_400);
}

export async function endSession(request: Request) {
  const token = readCookie(request, COOKIE);
  if (token) await db.webSession.deleteMany({ where: { id: sha256(token) } });
  return cookie("", 0);
}

export type WebAccount = {
  sessionId: string;
  user: { id: string; email: string; name: string | null };
  workspace: { id: string; shop: string; name: string; website: string | null; platform: string | null; country: string | null; role: string } | null;
  workspaces: { id: string; name: string }[];
};

// The signed-in person and workspace for a website request, or null.
export async function webAccount(request: Request): Promise<WebAccount | null> {
  if (isShopifyRequest(request)) return null;
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const s = await db.webSession.findUnique({
    where: { id: sha256(token) },
    include: { user: { include: { memberships: { include: { workspace: true }, orderBy: { createdAt: "asc" } } } } },
  });
  if (!s || s.expiresAt < new Date()) return null;
  const memberships = s.user.memberships;
  const m = memberships.find((x) => x.workspaceId === s.workspaceId) ?? memberships[0] ?? null;
  return {
    sessionId: s.id,
    user: { id: s.user.id, email: s.user.email, name: s.user.name },
    workspace: m
      ? { id: m.workspace.id, shop: m.workspace.shop, name: m.workspace.name, website: m.workspace.website, platform: m.workspace.platform, country: m.workspace.country, role: m.role }
      : null,
    workspaces: memberships.map((x) => ({ id: x.workspace.id, name: x.workspace.name })),
  };
}

export async function switchWorkspace(account: WebAccount, workspaceId: string) {
  if (!account.workspaces.some((w) => w.id === workspaceId)) return false;
  await db.webSession.update({ where: { id: account.sessionId }, data: { workspaceId } });
  return true;
}

export async function createWorkspace(
  account: Pick<WebAccount, "sessionId" | "user">,
  input: { name: string; website: string | null; platform: string | null; country: string | null },
) {
  const ws = await db.workspace.create({
    data: {
      shop: newWebShop(randomBytes(9).toString("base64url")),
      name: input.name,
      website: input.website,
      platform: input.platform,
      country: input.country,
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      members: { create: { userId: account.user.id, role: "owner" } },
    },
  });
  await db.webSession.update({ where: { id: account.sessionId }, data: { workspaceId: ws.id } });
  return ws;
}

// Who may sign up. Until billing is live, only people on the waitlist or
// invited by email; WEB_SIGNUP=open lets anyone.
export async function signupAllowed(email: string) {
  if (process.env.WEB_SIGNUP === "open") return true;
  const invited = (process.env.WEB_INVITES ?? "").split(",").map((s) => s.trim().toLowerCase());
  if (invited.includes(email)) return true;
  return !!(await db.waitlistEntry.findUnique({ where: { email } }));
}

// A few wrong passwords in a row slow that email down for 15 minutes.
const failures = new Map<string, { count: number; until: number }>();
export function loginLocked(email: string, now = Date.now()) {
  const f = failures.get(email);
  return !!f && f.count >= 8 && f.until > now;
}
export function loginFailed(email: string, now = Date.now()) {
  const f = failures.get(email);
  const count = f && f.until > now ? f.count + 1 : 1;
  failures.set(email, { count, until: now + 15 * 60_000 });
}
export const loginSucceeded = (email: string) => failures.delete(email);

// Password reset links, valid for an hour.
export async function createResetToken(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.webToken.create({ data: { id: sha256(token), userId, kind: "reset", expiresAt: new Date(Date.now() + 3_600_000) } });
  return token;
}

export async function consumeResetToken(token: string) {
  const row = await db.webToken.findUnique({ where: { id: sha256(token) } });
  if (!row || row.kind !== "reset" || row.expiresAt < new Date()) return null;
  await db.webToken.delete({ where: { id: row.id } });
  return row.userId;
}

export const safeNext = (next: string | null | undefined) =>
  next && next.startsWith("/app") && !next.startsWith("//") ? next : "/app";
