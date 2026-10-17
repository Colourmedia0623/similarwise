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

  it("reads the other scraper's shape too", () => {
    const [site] = parseSites([
      {
        url: "https://similarweb.com/website/tinyboxcompany.co.uk/",
        name: "tinyboxcompany.co.uk",
        totalVisits: 61234,
        organicTraffic: 0.8,
        paidTraffic: 0.2,
        trafficSources: { directVisitsShare: 0.4, referralVisitsShare: 0.05, searchVisitsShare: 0.5, socialNetworksVisitsShare: 0.03, mailVisitsShare: 0.01, adsVisitsShare: 0.01 },
        topCountries: [{ countryAlpha2Code: "GB", visitsShare: 0.92 }],
      },
    ]);
    expect(site).toMatchObject({ domain: "tinyboxcompany.co.uk", visits: 61234, countries: [{ code: "GB", share: 0.92 }], error: null });
    expect(site.sources.search).toBeCloseTo(0.4);
    expect(site.sources.paidSearch).toBeCloseTo(0.1);
    expect(site.sources).toMatchObject({ direct: 0.4, referrals: 0.05, social: 0.03, email: 0.01, display: 0.01 });
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
    await refreshSources(["rival.com", "new.com"], { client, force: true, now: NOW });
    const after = await siteSources(["rival.com", "new.com"]);
    expect(after.get("rival.com")?.visits).toBe(5000);
    expect(after.get("new.com")).toMatchObject({ fetchedAt: null, error: expect.stringMatching(/502/) });
  });
});
