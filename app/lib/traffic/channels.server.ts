import db from "../../db.server";
import { hostOf } from "../tracker/url";
import { parseStoredList } from "../tracker/check.server";
import { trafficClient, type TrafficClient } from "./dataforseo.server";
import { shopMarket } from "./refresh.server";
import { channelTools } from "./channels";

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

export async function refreshAllOwnTraffic() {
  const shops = await db.shopSettings.findMany({ where: { domain: { not: "" } }, select: { shop: true } });
  for (const { shop } of shops)
    await refreshOwnTraffic(shop).catch((err) => console.error(`Couldn't refresh ${shop}'s own traffic`, err));
}

export async function channelsOverview(shop: string) {
  const [s, market, competitors, ads] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopMarket(shop),
    db.competitor.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
    db.competitorAd.groupBy({ by: ["competitorId", "platform"], where: { active: true, competitor: { shop } }, _count: true }),
  ]);
  const live = (id: string, platform: string) => ads.find((a) => a.competitorId === id && a.platform === platform)?._count ?? 0;
  const own =
    s?.domain && s.ownTrafficDomain === s.domain && s.ownTrafficMarket === market.code && s.ownOrganicTraffic != null
      ? {
          id: "you",
          name: "You",
          domain: s.domain,
          you: true,
          organic: s.ownOrganicTraffic,
          paid: s.ownPaidTraffic ?? 0,
          paidCostCents: s.ownPaidCostCents ?? 0,
          liveAds: null,
          tools: null,
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
  }));
  return { market: market.name, ownDomain: s?.domain || null, sites: own ? [own, ...theirs] : theirs };
}
