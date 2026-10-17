import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { brandTerm, parseKeywords, parseOverview, parseTrafficSum, type DomainTraffic, type TrafficClient } from "./dataforseo.server";
import { marketFor } from "./markets";
import { detectShopMarket, refreshTraffic, setShopMarket, shopMarket, trafficChanges } from "./refresh.server";

const ok = (result: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result }] });

describe("DataForSEO responses", () => {
  it("reads a domain's organic and paid search numbers", () => {
    const json = ok([
      {
        target: "rival.com",
        items: [
          {
            metrics: {
              organic: { etv: 41234.6, count: 3120, estimated_paid_traffic_cost: 52000, pos_1: 40, pos_2_3: 75, pos_4_10: 300 },
              paid: { etv: 8800.2, count: 140, estimated_paid_traffic_cost: 12345.67 },
            },
          },
        ],
      },
    ]);
    expect(parseOverview(json)).toEqual({
      organicTraffic: 41235,
      organicKeywords: 3120,
      paidTraffic: 8800,
      paidKeywords: 140,
      paidCostCents: 1234567,
      top3Keywords: 115,
    });
  });

  it("adds up branded traffic and picks the brand term from the domain", () => {
    const kw = (keyword: string, etv: number) => ({
      keyword_data: { keyword },
      ranked_serp_element: { serp_item: { type: "organic", rank_group: 1, etv } },
    });
    expect(parseTrafficSum(ok([{ items: [kw("foldabox", 900.4), kw("foldabox boxes", 99.8)] }]))).toBe(1000);
    expect(brandTerm("www.foldabox.co.uk")).toBe("foldabox");
    expect(brandTerm("shop.rival.com")).toBe("rival");
    expect(brandTerm("wholesale-gift-boxes.com")).toBe("wholesale gift boxes");
    expect(brandTerm("abc.com")).toBeNull();
  });

  it("reads zeros for a domain with no data", () => {
    expect(parseOverview(ok([{ items: null }]))).toEqual({
      organicTraffic: 0,
      organicKeywords: 0,
      paidTraffic: 0,
      paidKeywords: 0,
      paidCostCents: 0,
      top3Keywords: 0,
    });
  });

  it("reads ranked keywords and skips other result types", () => {
    const json = ok([
      {
        items: [
          {
            keyword_data: { keyword: "waterproof jacket", keyword_info: { search_volume: 22000 } },
            ranked_serp_element: { serp_item: { type: "paid", rank_group: 1, etv: 950.4, url: "https://rival.com/x" } },
          },
          {
            keyword_data: { keyword: "rival", keyword_info: { search_volume: 5400 } },
            ranked_serp_element: { serp_item: { type: "organic", rank_group: 1, etv: 2000 } },
          },
          { keyword_data: { keyword: "map" }, ranked_serp_element: { serp_item: { type: "local_pack" } } },
        ],
      },
    ]);
    expect(parseKeywords(json)).toEqual([
      { keyword: "waterproof jacket", type: "paid", position: 1, searchVolume: 22000, traffic: 950, url: "https://rival.com/x" },
      { keyword: "rival", type: "organic", position: 1, searchVolume: 5400, traffic: 2000, url: null },
    ]);
  });

  it("raises DataForSEO's own error message", () => {
    expect(() => parseOverview({ status_code: 40100, status_message: "Not authorized" })).toThrow(
      "DataForSEO: Not authorized",
    );
    expect(() => parseOverview({ status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field" }] })).toThrow(
      "DataForSEO: Invalid Field",
    );
  });
});

const t = (o: Partial<DomainTraffic>): DomainTraffic => ({
  organicTraffic: 10000,
  organicKeywords: 500,
  paidTraffic: 0,
  paidKeywords: 0,
  paidCostCents: 0,
  ...o,
});

describe("trafficChanges", () => {
  it("notes starting Google Ads, big spend moves and big traffic moves", () => {
    expect(trafficChanges(null, t({}))).toEqual([]);
    expect(trafficChanges(t({}), t({ paidKeywords: 12, paidCostCents: 50000 }))).toEqual([
      { kind: "channel_added", message: "Started running Google search ads on 12 keywords" },
    ]);
    expect(
      trafficChanges(t({ paidKeywords: 5, paidCostCents: 200000 }), t({ paidKeywords: 9, paidCostCents: 400000, organicTraffic: 6000 })),
    ).toEqual([
      { kind: "spend_up", message: "Google Ads spend estimate went from $2,000.00 to $4,000.00 a month" },
      { kind: "traffic_down", message: "Search visits went from 10,000 to 6,000 a month" },
    ]);
    expect(trafficChanges(t({ paidKeywords: 5, paidCostCents: 200000 }), t({ paidKeywords: 5, paidCostCents: 220000 }))).toEqual([]);
  });
});

describe("refreshTraffic", () => {
  const SHOP = "mine.myshopify.com";
  let calls: string[] = [];
  let spend = 100_000;
  const client: TrafficClient = {
    async overview(domain, market) {
      calls.push(`${domain}@${market.code}`);
      return t({ paidKeywords: 3, paidCostCents: spend });
    },
    async keywords() {
      return [{ keyword: "jacket", type: "paid", position: 2, searchVolume: 1000, traffic: 50, url: null }];
    },
  };

  beforeEach(async () => {
    await db.competitor.deleteMany();
    await db.shopSettings.deleteMany();
    calls = [];
    spend = 100_000;
  });

  it("stores the numbers, refreshes weekly, and again when the market changes", async () => {
    const c = await db.competitor.create({ data: { shop: SHOP, url: "https://www.rival.com", name: "Rival" } });
    const now = new Date("2026-10-01T00:00:00Z");
    await refreshTraffic(c.id, { client, now });
    expect(calls).toEqual(["rival.com@US"]);
    let row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ organicTraffic: 10000, paidCostCents: 100_000, trafficMarket: "US", trafficError: null });
    expect(await db.competitorKeyword.count({ where: { competitorId: c.id } })).toBe(1);

    await refreshTraffic(c.id, { client, now: new Date("2026-10-04T00:00:00Z") });
    expect(calls).toHaveLength(1); // Still fresh.

    spend = 300_000;
    await refreshTraffic(c.id, { client, now: new Date("2026-10-09T00:00:00Z") });
    expect(calls).toHaveLength(2);
    expect(await db.competitorKeyword.count({ where: { competitorId: c.id } })).toBe(1);
    const events = await db.competitorEvent.findMany({ where: { competitorId: c.id } });
    expect(events.map((e) => e.kind)).toEqual(["spend_up"]);

    expect(marketFor("GB").location).toBe(2826);
    await setShopMarket(SHOP, "GB", client);
    expect(calls.at(-1)).toBe("rival.com@GB");
    row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.trafficMarket).toBe("GB");
    // A new market starts fresh: no "spend went up" against another country's numbers.
    expect(await db.competitorEvent.count({ where: { competitorId: c.id } })).toBe(1);
    expect(await db.trafficSnapshot.count({ where: { competitorId: c.id } })).toBe(3);
  });

  it("stores top 3 keywords and branded searches, and keeps the rest if branded fails", async () => {
    const c = await db.competitor.create({ data: { shop: SHOP, url: "https://rival-store.com", name: "Rival" } });
    const terms: string[] = [];
    const withBrand: TrafficClient = {
      ...client,
      async overview() {
        return { ...t({}), top3Keywords: 42 };
      },
      async brandedTraffic(_domain, term) {
        terms.push(term);
        return 2500;
      },
    };
    await refreshTraffic(c.id, { client: withBrand });
    let row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(terms).toEqual(["rival store"]);
    expect(row).toMatchObject({ top3Keywords: 42, brandTerm: "rival store", brandedTraffic: 2500, trafficError: null });

    await refreshTraffic(c.id, {
      force: true,
      client: {
        ...withBrand,
        async brandedTraffic() {
          throw new Error("DataForSEO: timeout");
        },
      },
    });
    row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ top3Keywords: 42, brandedTraffic: null, trafficError: null });
  });

  it("keeps the error and tries again next time", async () => {
    const c = await db.competitor.create({ data: { shop: SHOP, url: "https://rival.com", name: "Rival" } });
    const broken: TrafficClient = {
      ...client,
      async overview() {
        throw new Error("DataForSEO: Not authorized");
      },
    };
    await refreshTraffic(c.id, { client: broken });
    let row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.trafficError).toBe("Couldn't get search data: DataForSEO: Not authorized");
    expect(row.trafficAt).toBeNull();
    await refreshTraffic(c.id, { client });
    row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.trafficError).toBeNull();
  });

  it("does nothing when DataForSEO isn't set up", async () => {
    const c = await db.competitor.create({ data: { shop: SHOP, url: "https://rival.com", name: "Rival" } });
    await refreshTraffic(c.id, { client: null });
    expect((await db.competitor.findUniqueOrThrow({ where: { id: c.id } })).trafficAt).toBeNull();
  });
});

describe("detectShopMarket", () => {
  beforeEach(async () => {
    await db.shopSettings.deleteMany();
  });

  it("starts a new shop on its store country, and never overrides a choice", async () => {
    await detectShopMarket("uk.myshopify.com", async () => "GB");
    expect((await shopMarket("uk.myshopify.com")).code).toBe("GB");

    await setShopMarket("uk.myshopify.com", "DE", null);
    await detectShopMarket("uk.myshopify.com", async () => "GB");
    expect((await shopMarket("uk.myshopify.com")).code).toBe("DE");
  });

  it("falls back to the default for unknown countries or a failed lookup", async () => {
    await detectShopMarket("jp.myshopify.com", async () => "JP");
    expect((await shopMarket("jp.myshopify.com")).code).toBe("US");
    await detectShopMarket("down.myshopify.com", async () => {
      throw new Error("offline");
    });
    expect((await shopMarket("down.myshopify.com")).code).toBe("US");
  });
});
