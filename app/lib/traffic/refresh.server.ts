import db from "../../db.server";
import { hostOf } from "../tracker/url";
import { formatPrice, type Change } from "../tracker/diff";
import { trafficClient, type DomainTraffic, type TrafficClient } from "./dataforseo.server";
import { marketFor } from "./markets";

// Refreshes a competitor's search traffic, keywords and estimated Google
// Ads spend, at most once a week (the data itself changes monthly).

const WEEK = 7 * 24 * 3600_000;

// Picks a new shop's market from its store country, the first time it opens
// the app. Countries without a market keep the default. A shop that has
// already chosen a market is left alone.
export async function detectShopMarket(shop: string, readCountry: () => Promise<string | null>) {
  if (await db.shopSettings.findUnique({ where: { shop } })) return;
  let country: string | null = null;
  try {
    country = await readCountry();
  } catch {
    // Not knowing the country is fine: they can pick the market themselves.
  }
  const market = marketFor(country);
  await db.shopSettings.upsert({ where: { shop }, create: { shop, market: market.code }, update: {} });
}

export async function shopMarket(shop: string) {
  const s = await db.shopSettings.findUnique({ where: { shop } });
  return marketFor(s?.market);
}

export function trafficChanges(before: DomainTraffic | null, after: DomainTraffic): Change[] {
  if (!before) return [];
  const out: Change[] = [];
  if (before.paidKeywords === 0 && after.paidKeywords > 0)
    out.push({ kind: "channel_added", message: `Started running Google search ads on ${after.paidKeywords} keywords` });
  if (before.paidKeywords > 0 && after.paidKeywords === 0)
    out.push({ kind: "channel_removed", message: "Stopped running Google search ads" });
  const spend = (c: number) => formatPrice(c, "USD");
  if (before.paidCostCents >= 10_000 && after.paidCostCents > 0) {
    const ratio = after.paidCostCents / before.paidCostCents;
    if (ratio >= 1.3 || ratio <= 0.7)
      out.push({
        kind: ratio > 1 ? "spend_up" : "spend_down",
        message: `Google Ads spend estimate went from ${spend(before.paidCostCents)} to ${spend(after.paidCostCents)} a month`,
      });
  }
  if (before.organicTraffic >= 1000) {
    const ratio = after.organicTraffic / before.organicTraffic;
    if (ratio >= 1.3 || ratio <= 0.7)
      out.push({
        kind: ratio > 1 ? "traffic_up" : "traffic_down",
        message: `Search visits went from ${before.organicTraffic.toLocaleString("en")} to ${after.organicTraffic.toLocaleString("en")} a month`,
      });
  }
  return out;
}

export async function refreshTraffic(
  id: string,
  { client = trafficClient(), force = false, now = new Date() }: { client?: TrafficClient | null; force?: boolean; now?: Date } = {},
) {
  if (!client) return;
  const c = await db.competitor.findUnique({ where: { id } });
  if (!c) return;
  const market = await shopMarket(c.shop);
  const fresh = c.trafficAt && now.getTime() - c.trafficAt.getTime() < WEEK && c.trafficMarket === market.code;
  if (fresh && !force) return;
  const domain = hostOf(c.url);
  try {
    const [traffic, keywords] = await Promise.all([client.overview(domain, market), client.keywords(domain, market)]);
    const before: DomainTraffic | null =
      c.organicTraffic != null && c.trafficMarket === market.code
        ? {
            organicTraffic: c.organicTraffic,
            organicKeywords: c.organicKeywords ?? 0,
            paidTraffic: c.paidTraffic ?? 0,
            paidKeywords: c.paidKeywords ?? 0,
            paidCostCents: c.paidCostCents ?? 0,
          }
        : null;
    const changes = trafficChanges(before, traffic);
    await db.$transaction([
      db.competitorKeyword.deleteMany({ where: { competitorId: id } }),
      db.competitorKeyword.createMany({ data: keywords.map((k) => ({ competitorId: id, ...k })) }),
      db.trafficSnapshot.create({ data: { competitorId: id, takenAt: now, market: market.code, ...traffic } }),
      db.competitorEvent.createMany({
        data: changes.map((ch) => ({ competitorId: id, kind: ch.kind, message: ch.message, createdAt: now })),
      }),
      db.competitor.update({
        where: { id },
        data: { ...traffic, trafficMarket: market.code, trafficAt: now, trafficError: null },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.competitor.update({
      where: { id },
      // trafficAt stays as it was, so the next daily run tries again.
      data: { trafficError: `Couldn't get search data: ${message}`.slice(0, 300) },
    });
  }
}

// Sets the country a shop's numbers are for, and refreshes its competitors
// for it.
export async function setShopMarket(shop: string, code: string, client = trafficClient()) {
  const market = marketFor(code);
  await db.shopSettings.upsert({ where: { shop }, create: { shop, market: market.code }, update: { market: market.code } });
  const competitors = await db.competitor.findMany({ where: { shop }, select: { id: true } });
  for (const c of competitors) await refreshTraffic(c.id, { client });
  return market;
}
