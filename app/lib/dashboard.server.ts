import db from "../db.server";
import { aiShare } from "./ai/mentions.server";
import { trafficClient } from "./traffic/dataforseo.server";
import { MAX_COMPETITORS, parseStoredList } from "./tracker/check.server";
import { hostOf } from "./tracker/url";

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
    tiles: await tileNumbers(shop, competitors),
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

const parseCount = (json: string | undefined) => {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
};

// One headline number for each page, for the home page tiles. Null where
// there's nothing yet.
async function tileNumbers(shop: string, competitors: { id: string; url: string; apps: string; organicTraffic: number | null; productCount: number }[]) {
  const ids = competitors.map((c) => c.id);
  const domains = competitors.map((c) => hostOf(c.url));
  const [settings, matched, missing, ideas, links, ads, adIdeas, similar, measured, articles, planned, outreach, ai] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.productMatch.count({ where: { competitorId: { in: ids }, competitorProductId: { not: null } } }),
    db.keywordGap.findMany({ where: { competitorId: { in: ids }, yourPosition: null }, select: { keyword: true }, distinct: ["keyword"] }),
    db.keywordIdea.count({ where: { shop } }),
    db.competitorLink.findMany({ where: { competitorId: { in: ids } }, select: { domain: true }, distinct: ["domain"] }),
    db.competitorAd.count({ where: { competitorId: { in: ids }, active: true } }),
    db.adIdeas.findUnique({ where: { shop } }),
    db.similarSite.findMany({ where: { shop }, select: { domain: true } }),
    db.siteSources.count({ where: { domain: { in: domains }, visits: { not: null } } }),
    db.blogArticle.count({ where: { shop, shopifyId: { not: null } } }),
    db.plannedPost.count({ where: { shop, status: { not: "done" } } }),
    db.outreach.count({ where: { shop, status: { not: "draft" } } }),
    aiShare(shop),
  ]);
  const tracked = new Set([settings?.domain, ...domains]);
  const apps = new Set(competitors.flatMap((c) => parseStoredList(c.apps)));
  const visits = competitors.reduce((sum, c) => sum + (c.organicTraffic ?? 0), 0);
  const products = competitors.reduce((sum, c) => sum + c.productCount, 0);
  const or = (n: number) => (n > 0 ? n : null);
  return {
    competitors: competitors.length,
    maxCompetitors: MAX_COMPETITORS,
    products: or(products),
    similar: or(similar.filter((s) => !tracked.has(s.domain)).length),
    matched: or(matched),
    apps: or(apps.size),
    missingKeywords: or(missing.length),
    keywordIdeas: or(ideas),
    articles: or(articles),
    plannedPosts: or(planned),
    outreachSent: or(outreach),
    aiShare: ai,
    linkSites: or(links.length),
    searchVisits: or(visits),
    measured: or(measured),
    liveAds: or(ads),
    adIdeas: or(parseCount(adIdeas?.ideas)),
    alertsOn: settings ? settings.alertsOn || settings.digestOn : true,
  };
}
