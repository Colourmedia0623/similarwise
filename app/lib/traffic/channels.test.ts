import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { TrafficClient } from "./dataforseo.server";
import { channelTools } from "./channels";
import { channelsOverview, refreshOwnTraffic } from "./channels.server";

const SHOP = "mine.myshopify.com";
const NOW = new Date("2026-10-17T12:00:00Z");

function fakeClient() {
  const calls: string[] = [];
  const client: TrafficClient = {
    async overview(domain, market) {
      calls.push(`${domain}@${market.code}`);
      return { organicTraffic: 5000, organicKeywords: 300, paidTraffic: 200, paidKeywords: 10, paidCostCents: 15000 };
    },
    async keywords() {
      return [];
    },
  };
  return { calls, client };
}

describe("marketing channels", () => {
  beforeEach(async () => {
    await db.competitor.deleteMany();
    await db.shopSettings.deleteMany();
  });

  it("groups pixels and apps into channels", () => {
    expect(channelTools(["Meta (Facebook & Instagram)", "Google Ads", "Microsoft Ads (Bing)"], ["Klaviyo", "Judge.me"])).toEqual({
      social: ["Meta"],
      email: ["Klaviyo"],
      otherAds: ["Bing"],
    });
  });

  it("puts the shop's own search visits beside competitors'", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com", market: "GB" } });
    const c = await db.competitor.create({
      data: {
        shop: SHOP,
        name: "Rival",
        url: "https://rival.com",
        organicTraffic: 9000,
        paidTraffic: 0,
        paidCostCents: 0,
        trafficMarket: "GB",
        adChannels: JSON.stringify(["TikTok"]),
      },
    });
    await db.competitorAd.create({ data: { competitorId: c.id, platform: "tiktok", adId: "t1", firstSeenAt: NOW, lastSeenAt: NOW } });

    // Before the shop's numbers are in, only competitors show.
    expect((await channelsOverview(SHOP)).sites.map((s) => s.name)).toEqual(["Rival"]);

    const { calls, client } = fakeClient();
    await refreshOwnTraffic(SHOP, { client, now: NOW });
    await refreshOwnTraffic(SHOP, { client, now: new Date("2026-10-18T12:00:00Z") });
    expect(calls).toEqual(["mine.com@GB"]); // Weekly, like competitors.

    const { sites } = await channelsOverview(SHOP);
    expect(sites.map((s) => [s.name, s.organic, s.paid])).toEqual([
      ["You", 5000, 200],
      ["Rival", 9000, 0],
    ]);
    expect(sites[1].tools?.social).toEqual(["TikTok"]);
    expect(sites[1].liveAds).toEqual({ meta: 0, tiktok: 1, google: 0 });

    // A new website means new numbers.
    await db.shopSettings.update({ where: { shop: SHOP }, data: { domain: "new.com" } });
    expect((await channelsOverview(SHOP)).sites.map((s) => s.name)).toEqual(["Rival"]);
    await refreshOwnTraffic(SHOP, { client, now: new Date("2026-10-18T12:00:00Z") });
    expect(calls.at(-1)).toBe("new.com@GB");
  });
});
