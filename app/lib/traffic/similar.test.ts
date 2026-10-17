import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { parseCompetitors, refreshSimilar, similarSites, type SimilarClient } from "./similar.server";

const SHOP = "similar.myshopify.com";
const ok = (items: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] });

describe("similar sites", () => {
  beforeEach(async () => {
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
    await db.similarSite.deleteMany({ where: { shop: SHOP } });
  });

  it("reads DataForSEO's competing domains", () => {
    expect(
      parseCompetitors(
        ok([
          { domain: "www.Boxes.com", intersections: 120.4, full_domain_metrics: { organic: { etv: 5400.6 } } },
          { domain: "nometrics.com", intersections: 8 },
          { domain: "", intersections: 3 },
        ]),
      ),
    ).toEqual([
      { domain: "boxes.com", sharedKeywords: 120, traffic: 5401 },
      { domain: "nometrics.com", sharedKeywords: 8, traffic: null },
    ]);
  });

  it("merges sites similar to the shop and its competitors, leaving out tracked sites and marketplaces", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com" } });
    const found: Record<string, string[]> = {
      "mine.com": ["boxes.com", "rival.com", "amazon.co.uk", "uk.pinterest.com"],
      "rival.com": ["boxes.com", "wraps.com", "mine.com"],
    };
    const calls: string[] = [];
    const client: SimilarClient = {
      async competitors(domain) {
        calls.push(domain);
        return found[domain].map((d, i) => ({ domain: d, sharedKeywords: 100 - i, traffic: 1000 }));
      },
    };
    const now = new Date("2026-10-17T00:00:00Z");
    await refreshSimilar(SHOP, { client, now });
    await refreshSimilar(SHOP, { client, now: new Date("2026-10-19T00:00:00Z") });
    expect(calls).toEqual(["mine.com", "rival.com"]);

    let s = await similarSites(SHOP);
    expect(s.sites.map((x) => [x.domain, x.similarTo])).toEqual([
      ["boxes.com", ["You", "Rival"]],
      ["wraps.com", ["Rival"]],
    ]);
    expect(s.sites[0].sharedKeywords).toBe(200);

    // Once it's tracked, it drops off the list, and the next refresh is due.
    await db.competitor.create({ data: { shop: SHOP, name: "Boxes", url: "https://boxes.com" } });
    s = await similarSites(SHOP);
    expect(s.sites.map((x) => x.domain)).toEqual(["wraps.com"]);
    found["boxes.com"] = [];
    await refreshSimilar(SHOP, { client, now: new Date("2026-10-19T00:00:00Z") });
    expect(calls).toHaveLength(5);
  });

  it("keeps last week's list when every lookup fails", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    await refreshSimilar(SHOP, { client: { competitors: async () => [{ domain: "boxes.com", sharedKeywords: 5, traffic: null }] } });
    await refreshSimilar(SHOP, {
      force: true,
      client: {
        async competitors() {
          throw new Error("DataForSEO: Insufficient funds");
        },
      },
    });
    const s = await similarSites(SHOP);
    expect(s.error).toBe("Couldn't find similar sites: DataForSEO: Insufficient funds");
    expect(s.sites.map((x) => x.domain)).toEqual(["boxes.com"]);
  });
});
