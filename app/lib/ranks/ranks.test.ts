import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { addFromGap, addKeywords, parseSerp, rankOverview, refreshAllRanks, runRankCheck, startRankCheck, type SerpClient } from "./ranks.server";

const SHOP = "ranks.myshopify.com";
const DAY = 86400_000;
const NOW = new Date("2026-10-18T09:00:00Z");

const ok = (items: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] });

describe("rank tracker", () => {
  beforeEach(async () => {
    await db.keywordRank.deleteMany({ where: { shop: SHOP } });
    await db.trackedKeyword.deleteMany({ where: { shop: SHOP } });
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.create({ data: { shop: SHOP, domain: "giftboxes.co.uk", market: "GB" } });
  });

  it("reads Google's organic results, one per site", () => {
    const results = parseSerp(
      ok([
        { type: "paid", rank_group: 1, domain: "ads.com", url: "https://ads.com" },
        { type: "organic", rank_group: 1, domain: "www.Foldabox.co.uk", url: "https://www.foldabox.co.uk/a" },
        { type: "organic", rank_group: 2, domain: "foldabox.co.uk", url: "https://foldabox.co.uk/b" },
        { type: "organic", rank_group: 3, domain: "giftboxes.co.uk", url: "https://giftboxes.co.uk/boxes" },
      ]),
    );
    expect(results).toEqual([
      { domain: "foldabox.co.uk", position: 1, url: "https://www.foldabox.co.uk/a" },
      { domain: "giftboxes.co.uk", position: 3, url: "https://giftboxes.co.uk/boxes" },
    ]);
  });

  it("adds searches once each, up to the limit", async () => {
    expect(await addKeywords(SHOP, "Gift Boxes\n gift  boxes ,magnetic boxes")).toEqual({ added: 2, skipped: 0 });
    expect(await addKeywords(SHOP, "gift boxes")).toEqual({ added: 0, skipped: 0 });
    expect(await addKeywords(SHOP, Array.from({ length: 60 }, (_, i) => `search ${i}`).join("\n"))).toEqual({ added: 48, skipped: 12 });
    expect(await addKeywords(SHOP, "one more")).toEqual({ error: expect.stringMatching(/up to 50/) });
    expect(await addKeywords(SHOP, " ")).toEqual({ error: expect.any(String) });
  });

  it("needs keyword gap searches to add from it", async () => {
    expect(await addFromGap(SHOP)).toEqual({ error: expect.stringMatching(/keyword gap/) });
  });

  it("records where the shop and competitors rank, and the change over a week", async () => {
    const rival = await db.competitor.create({ data: { shop: SHOP, url: "https://www.foldabox.co.uk", name: "Foldabox" } });
    await addKeywords(SHOP, "gift boxes\nmagnetic boxes");
    let positions: Record<string, Record<string, number>> = { "gift boxes": { "giftboxes.co.uk": 12, "foldabox.co.uk": 2 }, "magnetic boxes": {} };
    const client: SerpClient = async (keyword) =>
      Object.entries(positions[keyword]).map(([domain, position]) => ({ domain, position, url: `https://${domain}/${keyword.replace(" ", "-")}` }));

    await runRankCheck(SHOP, { client, now: new Date(NOW.getTime() - 7 * DAY) });
    positions = { "gift boxes": { "giftboxes.co.uk": 4, "foldabox.co.uk": 1 }, "magnetic boxes": { "shop.giftboxes.co.uk": 9 } };
    expect(await runRankCheck(SHOP, { client, now: NOW })).toEqual({ ok: true });

    const view = await rankOverview(SHOP, NOW);
    const gift = view.keywords.find((k) => k.keyword === "gift boxes")!;
    const magnetic = view.keywords.find((k) => k.keyword === "magnetic boxes")!;
    expect(gift).toMatchObject({ position: 4, change: 8, competitors: [1], url: "https://giftboxes.co.uk/gift-boxes" });
    expect(magnetic).toMatchObject({ position: 9, change: 22, competitors: [null] });
    expect(view.trend.map((t) => t.top10)).toEqual([0, 2]);
    expect(view.competitors).toEqual([{ id: rival.id, name: "Foldabox" }]);
  });

  it("keeps a failed lookup and says so when every one fails", async () => {
    await addKeywords(SHOP, "gift boxes");
    const res = await runRankCheck(SHOP, { client: async () => Promise.reject(new Error("DataForSEO: limit")), now: NOW });
    expect(res).toEqual({ error: expect.stringMatching(/limit/) });
    const view = await rankOverview(SHOP, NOW);
    expect(view.keywords[0]).toMatchObject({ checked: true, error: expect.stringMatching(/limit/) });
    expect((await db.shopSettings.findUnique({ where: { shop: SHOP } }))?.ranksRunningAt).toBeNull();
  });

  it("checks daily, and not again within a few hours when asked", async () => {
    await addKeywords(SHOP, "gift boxes");
    let calls = 0;
    const client: SerpClient = async () => {
      calls++;
      return [];
    };
    await refreshAllRanks({ client, now: NOW });
    await refreshAllRanks({ client, now: new Date(NOW.getTime() + 3600_000) });
    expect(calls).toBe(1);
    expect(await startRankCheck(SHOP, { client, now: new Date(NOW.getTime() + 3600_000) })).toEqual({ error: expect.stringMatching(/last few hours/) });
    await refreshAllRanks({ client, now: new Date(NOW.getTime() + DAY) });
    expect(calls).toBe(2);
  });
});
