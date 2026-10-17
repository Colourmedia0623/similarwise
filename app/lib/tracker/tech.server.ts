import db from "../../db.server";
import { appCategory, APP_CATEGORIES, detectStorefront } from "./detect";
import { fetchPublic, type Fetcher } from "./fetch.server";
import { parseStoredList } from "./check.server";
import { hostOf } from "./url";
import { shopDomain } from "../traffic/gap.server";

// Website technologies: the theme, apps and ad pixels on each competitor's
// home page (read by the daily competitor check) beside the shop's own,
// which is read here once a day.

const DAY = 24 * 3600_000;

export async function refreshOwnTech(
  shop: string,
  { fetcher = fetchPublic, force = false, now = new Date() }: { fetcher?: Fetcher; force?: boolean; now?: Date } = {},
) {
  const domain = await shopDomain(shop);
  if (!domain) return;
  const s = await db.shopSettings.findUnique({ where: { shop } });
  const fresh = s?.ownTechAt && now.getTime() - s.ownTechAt.getTime() < DAY && s.ownTechDomain === domain;
  if (fresh && !force) return;
  try {
    const home = await fetcher(`https://${domain}`, "text/html");
    if (home.status >= 400) throw new Error(`your store answered with an error (${home.status})`);
    // A password page shows Shopify's own scripts and none of the store's apps.
    if (/\/password\/?$/.test(new URL(home.url).pathname)) throw new Error("your store is password protected");
    const front = detectStorefront(home.body);
    await db.shopSettings.update({
      where: { shop },
      data: {
        ownTheme: front.theme,
        ownApps: JSON.stringify(front.apps),
        ownAdChannels: JSON.stringify(front.adChannels),
        ownTechDomain: domain,
        ownTechAt: now,
        ownTechError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.shopSettings.update({
      where: { shop },
      data: { ownTechDomain: domain, ownTechAt: now, ownTechError: `Couldn't read your store: ${message}`.slice(0, 300) },
    });
  }
}

export async function refreshAllOwnTech() {
  for (const s of await db.shopSettings.findMany({ where: { domain: { not: null } }, select: { shop: true } })) {
    await refreshOwnTech(s.shop).catch((err) => console.error(`Couldn't read ${s.shop}'s own storefront`, err));
  }
}

const PIXELS = "Ad & analytics pixels";

export type TechStore = { id: string; name: string; theme: string | null; checked: boolean; isShopify: boolean };
export type TechRow = { name: string; you: boolean; users: string[] };
export type TechGroup = { category: string; rows: TechRow[] };

// One table per category of apps any store uses: which competitors have each
// one and whether the shop does, most-used first. "missing" is what at least
// half the competitors (and two or more) use that the shop doesn't.
export async function techOverview(shop: string) {
  const [s, competitors] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.competitor.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
  ]);
  const domain = s?.domain ?? null;
  const ownRead = !!domain && s?.ownTechDomain === domain && s.ownTechAt != null && !s.ownTechError;
  const rivals = competitors.filter((c) => !domain || hostOf(c.url) !== domain);
  const ownApps = new Set(ownRead ? [...parseStoredList(s!.ownApps), ...parseStoredList(s!.ownAdChannels).map((p) => `${PIXELS}:${p}`)] : []);

  const byCategory = new Map<string, Map<string, TechRow>>();
  const row = (category: string, name: string, key: string) => {
    const rows = byCategory.get(category) ?? new Map<string, TechRow>();
    byCategory.set(category, rows);
    const r = rows.get(name) ?? { name, you: ownApps.has(key), users: [] };
    rows.set(name, r);
    return r;
  };
  for (const c of rivals) {
    for (const a of parseStoredList(c.apps)) row(appCategory(a) ?? "Other", a, a).users.push(c.id);
    for (const p of parseStoredList(c.adChannels)) row(PIXELS, p, `${PIXELS}:${p}`).users.push(c.id);
  }
  // Apps only the shop uses still get a row, so the tables show its full set.
  if (ownRead) {
    for (const a of parseStoredList(s!.ownApps)) row(appCategory(a) ?? "Other", a, a);
    for (const p of parseStoredList(s!.ownAdChannels)) row(PIXELS, p, `${PIXELS}:${p}`);
  }

  const order = [...APP_CATEGORIES, "Other", PIXELS];
  const groups: TechGroup[] = [...byCategory.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([category, rows]) => ({
      category,
      rows: [...rows.values()].sort((a, b) => b.users.length - a.users.length || a.name.localeCompare(b.name)),
    }));

  const checked = rivals.filter((c) => c.lastCheckedAt != null);
  const half = Math.max(2, Math.ceil(checked.length / 2));
  const missing = ownRead
    ? groups.flatMap((g) => g.rows.filter((r) => !r.you && r.users.length >= half).map((r) => ({ ...r, category: g.category })))
    : [];

  return {
    domain,
    own: domain
      ? { theme: ownRead ? s!.ownTheme : null, read: ownRead, error: s?.ownTechDomain === domain ? (s.ownTechError ?? null) : null }
      : null,
    stores: rivals.map((c): TechStore => ({ id: c.id, name: c.name, theme: c.theme, checked: c.lastCheckedAt != null, isShopify: c.isShopify })),
    groups,
    missing: missing.sort((a, b) => b.users.length - a.users.length),
  };
}
