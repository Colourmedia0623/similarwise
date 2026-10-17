import db from "../../db.server";
import { hostOf, normalizeStoreUrl } from "../tracker/url";
import { gapClient, type GapClient } from "./dataforseo.server";
import { shopMarket } from "./refresh.server";

// The keyword gap: Google searches that bring a competitor visits where the
// shop's own website doesn't rank, or ranks below them. Refreshed weekly,
// like the rest of the search data.

const WEEK = 7 * 24 * 3600_000;

// A shop's own website, as a bare domain. "" means it has none worth comparing
// (only its myshopify.com address); null means it hasn't been looked up yet.
export async function shopDomain(shop: string): Promise<string | null> {
  const s = await db.shopSettings.findUnique({ where: { shop } });
  return s?.domain || null;
}

// Fills in the shop's website from its primary domain the first time it
// opens the app. A website the merchant set is left alone.
export async function detectShopDomain(shop: string, readHost: () => Promise<string | null>) {
  const s = await db.shopSettings.findUnique({ where: { shop } });
  if (s && s.domain !== null) return;
  let host: string | null = null;
  try {
    host = await readHost();
  } catch {
    // They can enter it themselves.
  }
  const domain = host && !host.endsWith(".myshopify.com") ? host.toLowerCase().replace(/^www\./, "") : "";
  if (s) await db.shopSettings.updateMany({ where: { shop, domain: null }, data: { domain } });
  else await db.shopSettings.upsert({ where: { shop }, create: { shop, domain }, update: {} });
}

// Sets the shop's website from what the merchant typed, and works the gap out
// again against it. Returns null when it isn't a web address.
export async function setShopDomain(shop: string, input: string, client = gapClient()) {
  const url = input.trim() ? normalizeStoreUrl(input) : "";
  if (url == null) return null;
  const domain = url ? hostOf(url) : "";
  await db.shopSettings.upsert({ where: { shop }, create: { shop, domain }, update: { domain } });
  const competitors = await db.competitor.findMany({ where: { shop }, select: { id: true } });
  for (const c of competitors) await refreshGap(c.id, { client });
  return domain;
}

export async function refreshGap(
  id: string,
  { client = gapClient(), force = false, now = new Date() }: { client?: GapClient | null; force?: boolean; now?: Date } = {},
) {
  if (!client) return;
  const c = await db.competitor.findUnique({ where: { id } });
  if (!c) return;
  const [yours, market] = await Promise.all([shopDomain(c.shop), shopMarket(c.shop)]);
  if (!yours) return;
  const theirs = hostOf(c.url);
  if (theirs === yours) return;
  const fresh =
    c.gapAt && now.getTime() - c.gapAt.getTime() < WEEK && c.gapDomain === yours && c.gapMarket === market.code;
  if (fresh && !force) return;
  try {
    const keywords = await client.gap(theirs, yours, market);
    await db.$transaction([
      db.keywordGap.deleteMany({ where: { competitorId: id } }),
      db.keywordGap.createMany({ data: keywords.map((k) => ({ competitorId: id, ...k })) }),
      db.competitor.update({
        where: { id },
        data: { gapAt: now, gapDomain: yours, gapMarket: market.code, gapError: null },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.competitor.update({
      where: { id },
      data: { gapError: `Couldn't get the keyword gap: ${message}`.slice(0, 300) },
    });
  }
}

export type GapRow = {
  keyword: string;
  searchVolume: number | null;
  cpcCents: number | null;
  yourPosition: number | null;
  // Every competitor that ranks for it, best placed first.
  competitors: { id: string; name: string; position: number | null; traffic: number | null; url: string | null }[];
};

const better = (a: number | null, b: number | null) => a != null && (b == null || a < b);

// The gap across all of a shop's competitors, one row per search:
// "missing" ones the shop doesn't rank for, "behind" ones a competitor ranks
// higher for, and "ahead" ones the shop beats them all on.
export async function keywordGap(shop: string) {
  const [domain, market, competitors] = await Promise.all([
    shopDomain(shop),
    shopMarket(shop),
    db.competitor.findMany({
      where: { shop },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, gapAt: true, gapDomain: true, gapError: true, gaps: true },
    }),
  ]);
  const byKeyword = new Map<string, GapRow>();
  for (const c of competitors) {
    // Rows worked out against an old website don't count.
    if (c.gapDomain !== domain) continue;
    for (const g of c.gaps) {
      const key = g.keyword.toLowerCase();
      let row = byKeyword.get(key);
      if (!row) {
        row = { keyword: g.keyword, searchVolume: g.searchVolume, cpcCents: g.cpcCents, yourPosition: null, competitors: [] };
        byKeyword.set(key, row);
      }
      row.searchVolume = Math.max(row.searchVolume ?? 0, g.searchVolume ?? 0) || row.searchVolume;
      if (better(g.yourPosition, row.yourPosition)) row.yourPosition = g.yourPosition;
      if (!row.competitors.some((x) => x.id === c.id))
        row.competitors.push({ id: c.id, name: c.name, position: g.theirPosition, traffic: g.theirTraffic, url: g.theirUrl });
    }
  }
  const rows = [...byKeyword.values()];
  for (const r of rows) r.competitors.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  const theirTraffic = (r: GapRow) => r.competitors.reduce((n, c) => n + (c.traffic ?? 0), 0);
  const byValue = (a: GapRow, b: GapRow) =>
    theirTraffic(b) - theirTraffic(a) || (b.searchVolume ?? 0) - (a.searchVolume ?? 0);

  const missing = rows.filter((r) => r.yourPosition == null).sort(byValue);
  const behind = rows
    .filter((r) => r.yourPosition != null && r.competitors.some((c) => better(c.position, r.yourPosition)))
    .sort(byValue);
  const ahead = rows
    .filter((r) => r.yourPosition != null && !r.competitors.some((c) => better(c.position, r.yourPosition)))
    .sort(byValue);
  return {
    domain,
    market: market.name,
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      ready: c.gapAt != null && c.gapDomain === domain,
      error: c.gapError,
    })),
    missing,
    behind,
    ahead,
    totals: {
      missing: missing.length,
      missingSearches: missing.reduce((n, r) => n + (r.searchVolume ?? 0), 0),
      missingVisits: missing.reduce((n, r) => n + theirTraffic(r), 0),
      behind: behind.length,
      ahead: ahead.length,
    },
  };
}
