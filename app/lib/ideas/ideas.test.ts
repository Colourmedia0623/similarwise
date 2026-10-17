import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { GapClient, GapKeyword } from "../traffic/dataforseo.server";
import { refreshGap } from "../traffic/gap.server";
import { keywordIdeas, parseIdeas, refreshIdeas, type IdeasClient, type IdeasInput } from "./ideas.server";

const SHOP = "ideas.myshopify.com";

const k = (keyword: string, o: Partial<GapKeyword> = {}): GapKeyword => ({
  keyword,
  searchVolume: 1000,
  cpcCents: 50,
  theirPosition: 3,
  theirTraffic: 100,
  theirUrl: null,
  yourPosition: null,
  ...o,
});

describe("keyword ideas", () => {
  beforeEach(async () => {
    await db.keywordIdea.deleteMany();
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
    await db.shopProduct.deleteMany({ where: { shop: SHOP } });
  });

  it("reads only well-formed ideas", () => {
    expect(
      parseIdeas({
        ideas: [
          { keyword: " gift boxes ", productRef: 2, pageKind: "product", pageName: "Box", seoTitle: "T", metaDescription: "M", intro: "I", why: "W" },
          { keyword: "how to wrap", productRef: 1, pageKind: "blog", pageName: "Guide", seoTitle: "", metaDescription: "", intro: "", why: "" },
          { keyword: "", pageKind: "product" },
          { keyword: "x", pageKind: "landing" },
        ],
      }),
    ).toEqual([
      { keyword: "gift boxes", productRef: 2, pageKind: "product", pageName: "Box", seoTitle: "T", metaDescription: "M", intro: "I", why: "W" },
      { keyword: "how to wrap", productRef: null, pageKind: "blog", pageName: "Guide", seoTitle: "", metaDescription: "", intro: "", why: "" },
    ]);
    expect(parseIdeas(null)).toEqual([]);
  });

  it("asks about the biggest gaps with the shop's products, and keeps the answer", async () => {
    expect(await refreshIdeas(SHOP, null)).toEqual({ error: expect.stringMatching(/switched on/) });

    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com", market: "GB" } });
    const rival = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com" } });
    const gapClient: GapClient = {
      async gap() {
        return [k("gift boxes", { searchVolume: 12000 }), k("kraft boxes", { searchVolume: 900, yourPosition: 9 }), k("ribbon", { yourPosition: 1 })];
      },
    };
    await refreshGap(rival.id, { client: gapClient });
    await db.shopProduct.createMany({
      data: [
        { shop: SHOP, productId: "gid://shopify/Product/2", handle: "kraft", title: "Kraft gift box", priceCents: 300, currency: "GBP" },
        { shop: SHOP, productId: "gid://shopify/Product/1", handle: "bag", title: "Black gift bag", priceCents: 200, currency: "GBP" },
      ],
    });

    let asked: IdeasInput | null = null;
    const client: IdeasClient = {
      async ideas(input) {
        asked = input;
        return [
          { keyword: "Kraft boxes", productRef: 1, pageKind: "product", pageName: "?", seoTitle: "Kraft Boxes | Mine", metaDescription: "M", intro: "I", why: "W" },
          { keyword: "gift boxes", productRef: 7, pageKind: "product", pageName: "Gift boxes", seoTitle: "Gift Boxes", metaDescription: "M", intro: "I", why: "W" },
        ];
      },
    };
    expect(await refreshIdeas(SHOP, client)).toEqual({ count: 2 });
    expect(asked).toMatchObject({
      website: "mine.com",
      competitors: ["Rival"],
      keywords: [
        { keyword: "gift boxes", searches: 12000, yourPosition: null, bestCompetitor: "Rival" },
        { keyword: "kraft boxes", searches: 900, yourPosition: 9 },
      ],
      products: [
        { ref: 0, title: "Black gift bag" },
        { ref: 1, title: "Kraft gift box" },
      ],
    });

    const { ideas } = await keywordIdeas(SHOP);
    expect(ideas.map((i) => [i.keyword, i.searchVolume, i.pageKind, i.pageName, i.productId])).toEqual([
      // Pointed at a product that isn't there, so it becomes a new page.
      ["gift boxes", 12000, "collection", "Gift boxes", null],
      ["Kraft boxes", 900, "product", "Kraft gift box", "gid://shopify/Product/2"],
    ]);

    // A new set replaces the old one.
    await refreshIdeas(SHOP, { ideas: async () => [] });
    expect((await keywordIdeas(SHOP)).ideas).toEqual([]);
  });
});
