import db from "../../db.server";
import { isFreeShop } from "../waitlist.server";
import { randomBytes } from "node:crypto";
import { TRIAL_DAYS } from "../billing";
import { isWebShop, newWebShop } from "./shop";

// Super admins of the web version: Colourmedia's own people, by email
// (ADMIN_EMAILS, comma-separated). Their workspaces are free, and they see the
// Admin page with every account, workspace, plan and the waitlist.

export const isAdminEmail = (email: string | null | undefined) =>
  !!email &&
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());

// Free when an admin set it, or when an admin is a member.
export async function workspaceIsFree(workspaceId: string) {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { free: true, members: { select: { user: { select: { email: true } } } } } });
  return !!ws && (ws.free || ws.members.some((m) => isAdminEmail(m.user.email)));
}

export async function adminOverview(now = new Date()) {
  const [users, workspaces, waitlist, shopifyStores] = await Promise.all([
    db.webUser.findMany({ orderBy: { createdAt: "desc" }, include: { memberships: { include: { workspace: { select: { name: true } } } } } }),
    db.workspace.findMany({ orderBy: { createdAt: "desc" }, include: { members: { include: { user: { select: { email: true } } } } } }),
    db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" } }),
    db.session.findMany({ distinct: ["shop"], select: { shop: true } }),
  ]);
  const status = (w: (typeof workspaces)[number]) => {
    if (w.free || w.members.some((m) => isAdminEmail(m.user.email))) return "Free";
    if (w.plan && ["active", "trialing", "past_due"].includes(w.planStatus ?? "")) return `${w.plan}${w.planStatus === "active" ? "" : ` · ${w.planStatus?.replace("_", " ")}`}`;
    if (w.trialEndsAt && w.trialEndsAt > now) return `Trial · ${Math.ceil((w.trialEndsAt.getTime() - now.getTime()) / 86_400_000)} days left`;
    return w.planStatus === "canceled" ? "Cancelled" : "No plan";
  };
  const rows = workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    website: w.website,
    platform: w.platform,
    status: status(w),
    paying: !!w.plan && ["active", "past_due"].includes(w.planStatus ?? ""),
    free: w.free,
    members: w.members.map((m) => m.user.email),
    createdAt: w.createdAt.toISOString(),
  }));
  const joined = new Set(users.map((u) => u.email));
  return {
    totals: {
      users: users.length,
      workspaces: workspaces.length,
      paying: rows.filter((r) => r.paying).length,
      trials: rows.filter((r) => r.status.startsWith("Trial")).length,
      shopifyStores: shopifyStores.length,
      waitlist: waitlist.length,
    },
    users: users.map((u) => ({
      email: u.email,
      name: u.name,
      google: !!u.googleId,
      admin: isAdminEmail(u.email),
      workspaces: u.memberships.map((m) => m.workspace.name),
      createdAt: u.createdAt.toISOString(),
    })),
    workspaces: rows,
    waitlist: waitlist.map((w) => ({ email: w.email, store: w.store, joined: joined.has(w.email), createdAt: w.createdAt.toISOString() })),
  };
}

export async function setWorkspaceFree(workspaceId: string, free: boolean) {
  await db.workspace.update({ where: { id: workspaceId }, data: { free } });
}

// Who can press Connect before Meta, TikTok and Google approve the app: the
// free Shopify stores, and web workspaces that are free or have an admin in
// them. Signing in then works once that person is a tester on the network's app.
export async function canTestConnections(shop: string) {
  if (isFreeShop(shop)) return true;
  if (!isWebShop(shop)) return false;
  const ws = await db.workspace.findUnique({ where: { shop }, select: { id: true } });
  return !!ws && workspaceIsFree(ws.id);
}

// An account an admin makes for a customer: their login (without a password;
// they set one from the emailed link) and a workspace they own, on the usual
// free trial or free. Someone who already has an account gets the new workspace.
export async function createClientAccount(input: { email: string; name: string | null; workspace: string; website: string | null; free: boolean }) {
  const existing = await db.webUser.findUnique({ where: { email: input.email } });
  const user = existing ?? (await db.webUser.create({ data: { email: input.email, name: input.name } }));
  const ws = await db.workspace.create({
    data: {
      shop: newWebShop(randomBytes(9).toString("base64url")),
      name: input.workspace,
      website: input.website,
      free: input.free,
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  // On the waitlist, so they can also sign in with Google while sign-ups are closed.
  await db.waitlistEntry.upsert({ where: { email: input.email }, create: { email: input.email }, update: {} });
  return { userId: user.id, workspaceId: ws.id, existing: !!existing, hasPassword: !!existing?.passwordHash };
}
