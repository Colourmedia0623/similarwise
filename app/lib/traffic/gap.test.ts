import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { parseIntersection, type GapClient, type GapKeyword } from "./dataforseo.server";
import { detectShopDomain, keywordGap, refreshGap, setShopDomain, shopDomain } from "./gap.server";

const SHOP = "mine.myshopify.com";
const ok = (result: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result }] });

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

describe("DataForSEO domain intersection", () => {
  it("reads both domains' positions, flat or wrapped", () => {
    const json = ok([
      {
        items: [
          {
            keyword_data: { keyword: "gift boxes", keyword_info: { search_volume: 12000, cpc: 0.84 } },
            first_domain_serp_element: { type: "organic", rank_group: 2, etv: 1500.6, url: "https://rival.com/boxes" },
            second_domain_serp_element: null,
          },
          {
            keyword_data: { keyword: "kraft boxes", keyword_info: { search_volume: 900 } },
            first_domain_serp_element: { serp_item: { rank_group: 5, etv: 40 } },
            second_domain_serp_element: { serp_item: { rank_group: 9 } },
          },
          { keyword_data: { keyword: "no ranking" } },
        ],
      },
    ]);
    expect(parseIntersection(json)).toEqual([
      k("gift boxes", { searchVolume: 12000, cpcCents: 84, theirPosition: 2, theirTraffic: 1501, theirUrl: "https://rival.com/boxes" }),
      k("kraft boxes", { searchVolume: 900, cpcCents: null, theirPosition: 5, theirTraffic: 40, yourPosition: 9 }),
    ]);
  });

  it("reads no results as an empty gap", () => {
    expect(parseIntersection(ok([{ items: null }]))).toEqual([]);
    expect(parseIntersection(ok([]))).toEqual([]);
  });
});

describe("the shop's website", () => {
  beforeEach(async () => {
    await db.shopSettings.deleteMany();
  });

  it("starts on the primary domain, skips myshopify.com, and keeps the merchant's choice", async () => {
    await detectShopDomain("a.myshopify.com", async () => "www.GiftBags.co.uk");
    expect(await shopDomain("a.myshopify.com")).toBe("giftbags.co.uk");

    await detectShopDomain("b.myshopify.com", async () => "b.myshopify.com");
    expect(await shopDomain("b.myshopify.com")).toBeNull();
    // Looked up once: an empty answer isn't asked again.
    await detectShopDomain("b.myshopify.com", async () => "later.com");
    expect(await shopDomain("b.myshopify.com")).toBeNull();

    expect(await setShopDomain("a.myshopify.com", "https://www.other.com/shop", null)).toBe("other.com");
    await detectShopDomain("a.myshopify.com", async () => "giftbags.co.uk");
    expect(await shopDomain("a.myshopify.com")).toBe("other.com");
    expect(await setShopDomain("a.myshopify.com", "not a website", null)).toBeNull();
  });

  it("fills in the website for a shop that already picked its market", async () => {
    await db.shopSettings.create({ data: { shop: "c.myshopify.com", market: "GB" } });
    await detectShopDomain("c.myshopify.com", async () => "c.co.uk");
    expect(await db.shopSettings.findUnique({ where: { shop: "c.myshopify.com" } })).toMatchObject({
      market: "GB",
      domain: "c.co.uk",
    });
  });
});

describe("keyword gap", () => {
  let calls: string[] = [];
  const answers: Record<string, GapKeyword[]> = {};
  const client: GapClient = {
    async gap(theirs, yours, market) {
      calls.push(`${theirs} vs ${yours}@${market.code}`);
      return answers[theirs] ?? [];
    },
  };

  beforeEach(async () => {
    await db.competitor.deleteMany();
    await db.shopSettings.deleteMany();
    calls = [];
  });

  const competitor = (name: string) =>
    db.competitor.create({ data: { shop: SHOP, name, url: `https://www.${name.toLowerCase()}.com` } });

  it("waits for the shop's website, then refreshes weekly or when it changes", async () => {
    const c = await competitor("Rival");
    answers["rival.com"] = [k("gift boxes")];
    await refreshGap(c.id, { client });
    expect(calls).toEqual([]);

    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com", market: "GB" } });
    const now = new Date("2026-10-01T00:00:00Z");
    await refreshGap(c.id, { client, now });
    expect(calls).toEqual(["rival.com vs mine.com@GB"]);
    await refreshGap(c.id, { client, now: new Date("2026-10-03T00:00:00Z") });
    expect(calls).toHaveLength(1);
    await refreshGap(c.id, { client, now: new Date("2026-10-09T00:00:00Z") });
    expect(calls).toHaveLength(2);
    expect(await db.keywordGap.count({ where: { competitorId: c.id } })).toBe(1);

    await setShopDomain(SHOP, "new.com", client);
    expect(calls.at(-1)).toBe("rival.com vs new.com@GB");
  });

  it("combines competitors into searches you miss, trail on and lead on", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    const rival = await competitor("Rival");
    const other = await competitor("Other");
    answers["rival.com"] = [
      k("gift boxes", { theirPosition: 2, theirTraffic: 900, searchVolume: 12000 }),
      k("kraft boxes", { theirPosition: 3, yourPosition: 8 }),
      k("ribbon", { theirPosition: 6, yourPosition: 2 }),
    ];
    answers["other.com"] = [
      k("Gift Boxes", { theirPosition: 1, theirTraffic: 1200, searchVolume: 12000 }),
      k("tissue paper", { theirPosition: 4, theirTraffic: 50, searchVolume: 400 }),
    ];
    await refreshGap(rival.id, { client });
    await refreshGap(other.id, { client });

    const gap = await keywordGap(SHOP);
    expect(gap.missing.map((r) => r.keyword)).toEqual(["gift boxes", "tissue paper"]);
    expect(gap.missing[0].competitors.map((c) => [c.name, c.position])).toEqual([
      ["Other", 1],
      ["Rival", 2],
    ]);
    expect(gap.behind.map((r) => [r.keyword, r.yourPosition])).toEqual([["kraft boxes", 8]]);
    expect(gap.ahead.map((r) => r.keyword)).toEqual(["ribbon"]);
    expect(gap.totals).toEqual({ missing: 2, missingSearches: 12400, missingVisits: 2150, behind: 1, ahead: 1 });
    expect(gap.competitors.every((c) => c.ready)).toBe(true);

    // Rows worked out against an old website drop out until refreshed.
    await db.shopSettings.update({ where: { shop: SHOP }, data: { domain: "moved.com" } });
    expect((await keywordGap(SHOP)).missing).toEqual([]);
  });

  it("keeps the error and the old rows when DataForSEO fails", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    const c = await competitor("Rival");
    answers["rival.com"] = [k("gift boxes")];
    await refreshGap(c.id, { client });
    await refreshGap(c.id, {
      force: true,
      client: {
        async gap() {
          throw new Error("DataForSEO: Not authorized");
        },
      },
    });
    const row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.gapError).toBe("Couldn't get the keyword gap: DataForSEO: Not authorized");
    expect(await db.keywordGap.count({ where: { competitorId: c.id } })).toBe(1);
  });
});
