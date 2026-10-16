import db from "../db.server";
import { parseStoredList } from "./tracker/check.server";
import { trafficClient } from "./traffic/dataforseo.server";

// The numbers for the overview page: what changed at the shop's competitors
// this week, and which ad channels each one is set up for.

const WEEK = 7 * 24 * 3600_000;

export async function overview(shop: string, now = new Date()) {
  const since = new Date(now.getTime() - WEEK);
  const competitors = await db.competitor.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
  const ids = competitors.map((c) => c.id);
  const [weekCounts, recent] = await Promise.all([
    db.competitorEvent.groupBy({
      by: ["kind"],
      where: { competitorId: { in: ids }, createdAt: { gte: since } },
      _count: true,
    }),
    db.competitorEvent.findMany({
      where: { competitorId: { in: ids }, kind: { not: "tracking" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { competitor: { select: { name: true, id: true } } },
    }),
  ]);
  const count = (...kinds: string[]) =>
    weekCounts.filter((w) => kinds.includes(w.kind)).reduce((s, w) => s + w._count, 0);
  return {
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      productCount: c.productCount,
      avgPriceCents: c.avgPriceCents,
      currency: c.currency,
      adChannels: parseStoredList(c.adChannels),
      lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
      lastError: c.lastError,
      organicTraffic: c.organicTraffic,
      paidCostCents: c.paidCostCents,
    })),
    searchOn: trafficClient() != null,
    week: {
      launches: count("launch"),
      priceChanges: count("price_up", "price_down"),
      removed: count("removed"),
      channelChanges: count("channel_added", "channel_removed", "spend_up", "spend_down"),
    },
    recent: recent.map((e) => ({
      id: e.id,
      kind: e.kind,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
      competitor: e.competitor,
    })),
  };
}
