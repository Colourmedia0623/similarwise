import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { adIdeas, parseAdIdeas, refreshAdIdeas, type AdIdeasClient, type AdsInput } from "./ad-ideas.server";

const SHOP = "adideas.myshopify.com";
const NOW = new Date("2026-10-17T12:00:00Z");

describe("ad ideas", () => {
  beforeEach(async () => {
    await db.adIdeas.deleteMany();
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopProduct.deleteMany({ where: { shop: SHOP } });
  });

  it("keeps only well-formed patterns and ideas", () => {
    expect(
      parseAdIdeas({
        patterns: [{ theme: "Free delivery", detail: "d", competitors: ["Rival", 3] }, { theme: "" }],
        ideas: [
          { productRef: 0, product: "Box", platform: "tiktok", angle: "a", headline: "Hi", primaryText: "p", cta: "Shop now", visual: "v", why: "w" },
          { productRef: "x", platform: "snap", headline: "Two" },
          { headline: "" },
        ],
      }),
    ).toEqual({
      patterns: [{ theme: "Free delivery", detail: "d", competitors: ["Rival"] }],
      ideas: [
        { productRef: 0, product: "Box", platform: "tiktok", angle: "a", headline: "Hi", primaryText: "p", cta: "Shop now", visual: "v", why: "w" },
        { productRef: null, product: "", platform: "meta", angle: "", headline: "Two", primaryText: "", cta: "", visual: "", why: "" },
      ],
    });
  });

  it("sends the longest-running ads and the shop's products, and keeps the answer", async () => {
    expect(await refreshAdIdeas(SHOP, null)).toEqual({ error: expect.stringMatching(/switched on/) });
    const rival = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com" } });
    const client: AdIdeasClient = { ideas: async () => ({ patterns: [], ideas: [] }) };
    expect(await refreshAdIdeas(SHOP, client, NOW)).toEqual({ error: expect.stringMatching(/no competitor ads/) });

    await db.competitorAd.createMany({
      data: [
        { competitorId: rival.id, platform: "meta", adId: "new", text: "New ad", startedAt: new Date("2026-10-10T12:00:00Z") },
        { competitorId: rival.id, platform: "meta", adId: "old", title: "Free delivery", text: "Old ad", startedAt: new Date("2026-08-18T12:00:00Z") },
        { competitorId: rival.id, platform: "google", adId: "blank" },
        { competitorId: rival.id, platform: "tiktok", adId: "off", text: "Stopped", active: false },
      ],
    });
    await db.shopProduct.create({
      data: { shop: SHOP, productId: "gid://shopify/Product/9", handle: "kraft", title: "Kraft gift box", priceCents: 350, currency: "GBP" },
    });

    let asked: AdsInput | null = null;
    client.ideas = async (input) => {
      asked = input;
      return {
        patterns: [{ theme: "Free delivery", detail: "Rival leads with it.", competitors: ["Rival"] }],
        ideas: [
          { productRef: 0, product: "?", platform: "meta", angle: "Gift-ready", headline: "Ready to gift", primaryText: "p", cta: "Shop now", visual: "v", why: "w" },
          { productRef: 5, product: "", platform: "tiktok", angle: "Range", headline: "Every size", primaryText: "p", cta: "Shop now", visual: "v", why: "w" },
        ],
      };
    };
    expect(await refreshAdIdeas(SHOP, client, NOW)).toEqual({ count: 2 });
    expect(asked).toMatchObject({
      competitors: ["Rival"],
      ads: [
        { competitor: "Rival", platform: "meta", daysRunning: 60, title: "Free delivery", text: "Old ad" },
        { daysRunning: 7, text: "New ad" },
      ],
      products: [{ ref: 0, title: "Kraft gift box", price: "3.50 GBP" }],
    });
    expect(asked!.ads).toHaveLength(2);

    const saved = await adIdeas(SHOP);
    expect(saved.adsRead).toBe(2);
    expect(saved.patterns).toEqual([{ theme: "Free delivery", detail: "Rival leads with it.", competitors: ["Rival"] }]);
    expect(saved.ideas.map((i) => [i.headline, i.product, i.productId])).toEqual([
      ["Ready to gift", "Kraft gift box", "gid://shopify/Product/9"],
      ["Every size", "Whole range", null],
    ]);
  });
});
