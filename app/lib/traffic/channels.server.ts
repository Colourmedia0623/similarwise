import db from "../../db.server";
import { hostOf } from "../tracker/url";
import { parseStoredList } from "../tracker/check.server";
import { trafficClient, type TrafficClient } from "./dataforseo.server";
import { shopMarket } from "./refresh.server";
import { channelTools } from "./channels";
import { refreshSources, siteSources } from "./sources.server";

// Marketing channels: each competitor's Google search visits, organic and
// from ads, beside the shop's own, and the other channels each one is set up
// for. Shares of direct, referral and email visits would need a traffic panel.

const WEEK = 7 * 24 * 3600_000;

// The shop's own search numbers, refreshed weekly like competitors'.
export async function refreshOwnTraffic(
  shop: string,
  { client = trafficClient(), force = false, now = new Date() }: { client?: TrafficClient | null; force?: boolean; now?: Date } = {},
) {
  if (!client) return;
  const s = await db.shopSettings.findUnique({ where: { shop } });
  if (!s?.domain) return;
  const market = await shopMarket(shop);
  const fresh =
    s.ownTrafficAt &&
    now.getTime() - s.ownTrafficAt.getTime() < WEEK &&
    s.ownTrafficDomain === s.domain &&
    s.ownTrafficMarket === market.code;
  if (fresh && !force) return;
  const t = await client.overview(s.domain, market);
  await db.shopSettings.update({
    where: { shop },
    data: {
      ownOrganicTraffic: t.organicTraffic,
      ownPaidTraffic: t.paidTraffic,
      ownPaidCostCents: t.paidCostCents,
      ownTrafficDomain: s.domain,
      ownTrafficMarket: market.code,
      ownTrafficAt: now,
    },
  });
}

// The shop's website and its competitors', for the traffic sources.
async function shopDomains(shop: string) {
  const [s, competitors] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.competitor.findMany({ where: { shop }, select: { url: true } }),
  ]);
  return [...(s?.domain ? [s.domain] : []), ...competitors.map((c) => hostOf(c.url))];
}

export async function refreshShopSources(shop: string, opts: { force?: boolean } = {}) {
  await refreshSources(await shopDomains(shop), opts);
}

export async function refreshAllOwnTraffic() {
  const shops = new Set([
    ...(await db.shopSettings.findMany({ select: { shop: true } })).map((s) => s.shop),
    ...(await db.competitor.findMany({ select: { shop: true }, distinct: ["shop"] })).map((c) => c.shop),
  ]);
  for (const shop of shops) {
    await refreshOwnTraffic(shop).catch((err) => console.error(`Couldn't refresh ${shop}'s own traffic`, err));
    await refreshShopSources(shop).catch((err) => console.error(`Couldn't refresh ${shop}'s traffic sources`, err));
  }
}

export async function channelsOverview(shop: string) {
  const [s, market, competitors, ads] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopMarket(shop),
    db.competitor.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
    db.competitorAd.groupBy({ by: ["competitorId", "platform"], where: { active: true, competitor: { shop } }, _count: true }),
  ]);
  const sources = await siteSources([...(s?.domain ? [s.domain] : []), ...competitors.map((c) => hostOf(c.url))]);
  const live = (id: string, platform: string) => ads.find((a) => a.competitorId === id && a.platform === platform)?._count ?? 0;
  const own =
    s?.domain && ((s.ownTrafficDomain === s.domain && s.ownTrafficMarket === market.code && s.ownOrganicTraffic != null) || sources.has(s.domain))
      ? {
          id: "you",
          name: "You",
          domain: s.domain,
          you: true,
          organic: s.ownTrafficDomain === s.domain && s.ownTrafficMarket === market.code ? s.ownOrganicTraffic : null,
          paid: s.ownTrafficDomain === s.domain && s.ownTrafficMarket === market.code ? (s.ownPaidTraffic ?? 0) : null,
          paidCostCents: s.ownTrafficDomain === s.domain && s.ownTrafficMarket === market.code ? (s.ownPaidCostCents ?? 0) : null,
          liveAds: null,
          tools: null,
          traffic: sources.get(s.domain) ?? null,
        }
      : null;
  const theirs = competitors.map((c) => ({
    id: c.id,
    name: c.name,
    domain: hostOf(c.url),
    you: false,
    organic: c.trafficMarket === market.code ? c.organicTraffic : null,
    paid: c.trafficMarket === market.code ? (c.paidTraffic ?? 0) : null,
    paidCostCents: c.trafficMarket === market.code ? (c.paidCostCents ?? 0) : null,
    liveAds: { meta: live(c.id, "meta"), tiktok: live(c.id, "tiktok"), google: live(c.id, "google") },
    tools: channelTools(parseStoredList(c.adChannels), parseStoredList(c.apps)),
    traffic: sources.get(hostOf(c.url)) ?? null,
  }));
  return { market: market.name, ownDomain: s?.domain || null, sites: own ? [own, ...theirs] : theirs };
}
