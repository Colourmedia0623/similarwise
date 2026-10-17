import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { linkGap, parseLinkingSites, refreshLinks, writePitch, type LinksClient } from "./links.server";

const SHOP = "links.myshopify.com";
const ok = (items: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] });

describe("link gap", () => {
  beforeEach(async () => {
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("reads DataForSEO's linking domains", () => {
    expect(
      parseLinkingSites(
        ok([
          { domain_intersection: { "1": { target: "www.Blog.com", rank: 41.6, backlinks: 3, first_seen: "2025-03-01 10:00:00 +00:00" } } },
          { domain_intersection: { "1": { target: "dir.com", first_seen: "nonsense" } } },
          { domain_intersection: {} },
        ]),
      ),
    ).toEqual([
      { domain: "blog.com", rank: 42, backlinks: 3, firstSeen: new Date("2025-03-01T10:00:00Z") },
      { domain: "dir.com", rank: null, backlinks: null, firstSeen: null },
    ]);
    expect(() => parseLinkingSites({ status_code: 20000, tasks: [{ status_code: 40204, status_message: "Access denied." }] })).toThrow(/Access denied/);
  });

  it("ranks sites by authority and competitor count, and says when Backlinks is off", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    const rival = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com" } });
    const other = await db.competitor.create({ data: { shop: SHOP, name: "Other", url: "https://other.com" } });
    const sites: Record<string, string[]> = { "rival.com": ["blog.com", "big.com", "other.com", "zero.com", "uk.pinterest.com"], "other.com": ["blog.com", "mine.com", "zero.com"] };
    const calls: string[] = [];
    const client: LinksClient = {
      async linkingSites(theirs, yours) {
        calls.push(`${theirs}-${yours}`);
        return sites[theirs].map((domain) => ({ domain, rank: domain === "big.com" ? 80 : domain === "zero.com" ? 0 : 20, backlinks: 2, firstSeen: null }));
      },
    };
    const now = new Date("2026-10-17T00:00:00Z");
    await refreshLinks(rival.id, { client, now });
    await refreshLinks(other.id, { client, now });
    await refreshLinks(rival.id, { client, now: new Date("2026-10-20T00:00:00Z") });
    expect(calls).toEqual(["rival.com-mine.com", "other.com-mine.com"]);

    const gap = await linkGap(SHOP);
    expect(gap.sites.map((s) => [s.domain, s.competitors.map((c) => c.name), s.platform])).toEqual([
      ["big.com", ["Rival"], false],
      ["blog.com", ["Rival", "Other"], false],
      ["uk.pinterest.com", ["Rival"], true],
      ["zero.com", ["Rival", "Other"], false],
    ]);
    expect(gap.shared).toBe(2);

    await refreshLinks(rival.id, {
      force: true,
      client: {
        async linkingSites() {
          throw new Error("DataForSEO: Access denied. Visit Plans and Subscriptions to activate your subscription.");
        },
      },
    });
    expect((await linkGap(SHOP)).competitors[0].error).toMatch(/Backlinks aren't switched on/);
    // The old rows stay.
    expect((await linkGap(SHOP)).sites).toHaveLength(4);
  });

  it("writes a pitch for a site in the gap", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    const rival = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com" } });
    await refreshLinks(rival.id, { client: { linkingSites: async () => [{ domain: "blog.com", rank: 30, backlinks: 1, firstSeen: null }] } });
    let sent: unknown = null;
    const ask = async (_system: string, input: unknown) => {
      sent = input;
      return { subject: " Gift boxes for your guide ", body: "Hi..." };
    };
    expect(await writePitch(SHOP, "blog.com", ask)).toEqual({ subject: "Gift boxes for your guide", body: "Hi..." });
    expect(sent).toMatchObject({ shopWebsite: "mine.com", site: "blog.com", linksTo: ["Rival"] });
    expect(await writePitch(SHOP, "nope.com", ask)).toEqual({ error: expect.stringMatching(/isn't in your link gap/) });
    expect(await writePitch(SHOP, "blog.com", null)).toEqual({ error: expect.stringMatching(/switched on/) });
  });
});
