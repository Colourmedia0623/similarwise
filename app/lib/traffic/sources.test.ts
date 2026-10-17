import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { parseSites, refreshSources, siteSources, type SourcesClient } from "./sources.server";

const NOW = new Date("2026-10-17T12:00:00Z");

describe("traffic sources", () => {
  beforeEach(async () => {
    await db.siteSources.deleteMany();
  });

  it("folds Similarweb's channels into the page's", () => {
    const [site, small] = parseSites([
      {
        domain: "www.Rival.com",
        monthly_visits_avg: 21000.4,
        traffic_sources: { direct: 0.4, search_organic: 0.3, search_paid: 0.1, social_organic: 0.05, social_paid: 0.05, referrals: 0.04, mail: 0.03, display_ads: 0.02, gen_ai: 0.005, affiliate: 0.005 },
        top_countries: [{ cc: "gb", share: 0.8 }, { cc: "US", share: 0.1 }],
        error: null,
      },
      { domain: "tiny.co.uk", traffic_sources: {}, is_small: true },
    ]);
    expect(site).toMatchObject({ domain: "rival.com", visits: 21000, error: null, countries: [{ code: "GB", share: 0.8 }, { code: "US", share: 0.1 }] });
    expect(site.sources.social).toBeCloseTo(0.1);
    expect(site.sources.other).toBeCloseTo(0.01);
    expect(small.error).toMatch(/Too few visitors/);
  });

  it("reads tri_angle's list, where the free page hides most channels", () => {
    const [site] = parseSites([
      {
        name: "tinyboxcompany.co.uk",
        url: "https://www.similarweb.com/website/tinyboxcompany.co.uk",
        totalVisits: 87268,
        countryRank: 17399,
        trafficSources: [
          { source: "direct", rank: 1, percentage: 0.37276575948307916, isHigher: null },
          { source: "paid", rank: 2, percentage: null },
          { source: "organic", rank: 3, percentage: 0.4 },
          { source: "mail", rank: null, percentage: null },
          { source: "social_paid", rank: null, percentage: 0.01 },
          { source: "social_organic", rank: null, percentage: 0.02 },
          { source: "affiliate", rank: -1, percentage: null },
        ],
      },
    ]);
    expect(site).toMatchObject({ domain: "tinyboxcompany.co.uk", visits: 87268, countries: [], error: null });
    expect(site.sources.direct).toBeCloseTo(0.3728);
    expect(site.sources.social).toBeCloseTo(0.03);
    expect(site.sources).toMatchObject({ search: 0.4 });
    expect(Object.keys(site.sources).sort()).toEqual(["direct", "search", "social"]);
  });

  it("reads due domains in one run, weekly", async () => {
    const runs: string[][] = [];
    const client: SourcesClient = {
      async sites(domains) {
        runs.push(domains);
        return parseSites([{ domain: "rival.com", monthly_visits_avg: 5000, traffic_sources: { direct: 1 } }]);
      },
    };
    await refreshSources(["rival.com", "www.other.com", "rival.com"], { client, now: NOW });
    expect(runs).toEqual([["rival.com", "other.com"]]);
    await refreshSources(["rival.com"], { client, now: new Date("2026-10-18T12:00:00Z") });
    expect(runs).toHaveLength(1);
    const got = await siteSources(["rival.com", "other.com"]);
    expect(got.get("rival.com")).toMatchObject({ visits: 5000, sources: { direct: 1 }, error: null });
    expect(got.get("other.com")?.error).toMatch(/no figures/);

    // A failed run leaves what was there and tries again next time.
    client.sites = async () => {
      throw new Error("Apify answered 502");
    };
    await refreshSources(["rival.com", "brandnew.example"], { client, force: true, now: NOW });
    const after = await siteSources(["rival.com", "brandnew.example"]);
    expect(after.get("rival.com")?.visits).toBe(5000);
    expect(after.get("brandnew.example")).toMatchObject({ fetchedAt: null, error: expect.stringMatching(/502/) });
  });
});
