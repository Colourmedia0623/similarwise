import db from "../db.server";
import type { Signup } from "./waitlist";

// Colourmedia's own stores: the only ones that see the waitlist in the app.
const OWNER_SHOPS = (process.env.OWNER_SHOPS ?? "gift-boxes-3000.myshopify.com,colourmedia-8652.myshopify.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const isOwnerShop = (shop: string) => OWNER_SHOPS.includes(shop);

// One row per email: signing up again only updates the store.
export async function saveSignup(s: Signup) {
  await db.waitlistEntry.upsert({ where: { email: s.email }, create: s, update: { store: s.store ?? undefined } });
}

export async function waitlist() {
  const rows = await db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ email: r.email, store: r.store, createdAt: r.createdAt.toISOString() }));
}
