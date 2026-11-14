import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { adsOverview, refreshAds } from "./ads.server";
import { forgetLinkedInToken, linkedInAdsClient, parseLinkedInAds, type LinkedInAdsClient } from "./linkedin.server";

const SHOP = "linkedin-ads.myshopify.com";
const NOW = new Date("2026-11-14T12:00:00Z");
const DAY = 86400_000;

const element = (n: number, advertiser: string, last: number) => ({
  adUrl: `https://www.linkedin.com/ad-library/detail/${n}`,
  details: {
    advertiser: { advertiserName: advertiser, advertiserUrl: "https://www.linkedin.com/company/rival" },
    type: "SINGLE_IMAGE",
    adStatistics: { firstImpressionAt: NOW.getTime() - 30 * DAY, latestImpressionAt: last },
  },
});

describe("LinkedIn ad library", () => {
  beforeEach(async () => {
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    forgetLinkedInToken();
  });

  it("reads ads, marking ones not shown for a week as stopped", () => {
    const page = parseLinkedInAds({ elements: [element(11, "Rival", NOW.getTime() - DAY), element(12, "Rival", NOW.getTime() - 20 * DAY), { details: {} }], paging: { start: 0, count: 25, total: 2 } }, NOW);
    expect(page.complete).toBe(true);
    expect(page.ads).toHaveLength(2);
    expect(page.ads[0]).toMatchObject({
      platform: "linkedin",
      adId: "11",
      advertiser: "Rival",
      adUrl: "https://www.linkedin.com/ad-library/detail/11",
      format: "SINGLE IMAGE",
      startedAt: new Date(NOW.getTime() - 30 * DAY),
      active: true,
    });
    expect(page.ads[1].active).toBe(false);
  });

  it("signs in as the app and searches by advertiser", async () => {
    process.env.LINKEDIN_CLIENT_ID = "li-app";
    process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input).includes("accessToken")) return new Response(JSON.stringify({ access_token: "app-token", expires_in: 1800 }));
      return new Response(JSON.stringify({ elements: [element(5, "Rival", NOW.getTime())], paging: { start: 0, total: 1 } }));
    }) as typeof fetch;
    const client = linkedInAdsClient(f, () => NOW.getTime())!;
    await client.ads("Rival");
    await client.ads("Rival Boxes");
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.LINKEDIN_CLIENT_SECRET;
    // One app token, reused.
    expect(calls.filter((c) => c.url.includes("accessToken"))).toHaveLength(1);
    expect(String(calls[0].init?.body)).toContain("grant_type=client_credentials");
    const search = new URL(calls[1].url);
    expect(search.origin + search.pathname).toBe("https://api.linkedin.com/rest/adLibrary");
    expect(search.searchParams.get("q")).toBe("criteria");
    expect(search.searchParams.get("advertiser")).toBe("Rival");
    const headers = new Headers(calls[1].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer app-token");
    expect(headers.get("linkedin-version")).toMatch(/^\d{6}$/);
  });

  it("keeps only the competitor's own LinkedIn ads", async () => {
    const c = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://www.rival.com" } });
    const linkedin: LinkedInAdsClient = {
      ads: async () => ({ ads: parseLinkedInAds({ elements: [element(1, "Rival", NOW.getTime()), element(2, "Rival Recruitment Ltd", NOW.getTime())] }, NOW).ads, complete: true }),
    };
    await refreshAds(c.id, { client: null, linkedin, now: NOW });
    const out = await adsOverview(SHOP, { platform: "linkedin" });
    expect(out.ads.map((a) => a.adUrl)).toEqual(["https://www.linkedin.com/ad-library/detail/1"]);
    expect(out.competitors[0].counts.linkedin).toBe(1);
    expect(out.competitors[0].error).toBeNull();
  });

  it("shows LinkedIn's error and keeps the last check time when every source fails", async () => {
    const c = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://www.rival.com" } });
    const linkedin: LinkedInAdsClient = {
      ads: async () => {
        throw new Error("Not enough permissions");
      },
    };
    await refreshAds(c.id, { client: null, linkedin, now: NOW });
    const after = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.adsError).toBe("LinkedIn: Not enough permissions");
    expect(after.adsAt).toBeNull();
  });
});
