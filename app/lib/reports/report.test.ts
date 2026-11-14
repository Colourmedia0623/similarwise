import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { Email } from "../email/send.server";
import type { Fetch } from "../paidsocial/networks.server";
import { change, reportRange, socialSummary } from "./report";
import { performanceReport } from "./report.server";
import { reportEmail, sendMonthlyReports } from "./email.server";
import { saveAdAccounts } from "../paidsocial/paid.server";

const SHOP = "report.myshopify.com";
const NOW = new Date("2026-11-14T10:00:00Z");
const noFetch = (async () => {
  throw new Error("no network in this test");
}) as unknown as Fetch;

describe("report periods", () => {
  it("compares the last 7 and 30 days with the days just before", () => {
    expect(reportRange("7", NOW)).toMatchObject({
      since: "2026-11-08",
      until: "2026-11-14",
      prevSince: "2026-11-01",
      prevUntil: "2026-11-07",
      days: 7,
    });
    expect(reportRange("30", NOW)).toMatchObject({
      since: "2026-10-16",
      until: "2026-11-14",
      prevSince: "2026-09-16",
      prevUntil: "2026-10-15",
      days: 30,
    });
  });

  it("compares last month with the whole month before it", () => {
    const r = reportRange("last-month", NOW);
    expect(r).toMatchObject({
      since: "2026-10-01",
      until: "2026-10-31",
      prevSince: "2026-09-01",
      prevUntil: "2026-09-30",
      days: 31,
    });
    expect(r.label).toBe("1 Oct to 31 Oct 2026");
    expect(
      reportRange("last-month", new Date("2027-01-03T00:00:00Z")),
    ).toMatchObject({
      since: "2026-12-01",
      until: "2026-12-31",
      prevSince: "2026-11-01",
      prevUntil: "2026-11-30",
    });
  });

  it("compares part of this month with the same days of the month before", () => {
    expect(reportRange("this-month", NOW)).toMatchObject({
      since: "2026-11-01",
      until: "2026-11-14",
      prevSince: "2026-10-01",
      prevUntil: "2026-10-14",
    });
    // 31 March compares with all of February, not days past its end.
    expect(
      reportRange("this-month", new Date("2027-03-31T12:00:00Z")),
    ).toMatchObject({ prevSince: "2027-02-01", prevUntil: "2027-02-28" });
  });

  it("adds up posts, leaving figures no network gave as unknown", () => {
    expect(
      socialSummary([
        { likes: 10, comments: 2, reach: 400 },
        { likes: 4, reach: 100 },
        null,
      ]),
    ).toEqual({
      posts: 3,
      reach: 500,
      engagements: 16,
      rate: 3.2,
      clicks: undefined,
    });
    expect(change(150, 100)).toBe(50);
    expect(change(5, 0)).toBeNull();
    expect(change(5, null)).toBeNull();
  });
});

describe("performance report", () => {
  beforeEach(async () => {
    for (const t of [
      db.socialPost,
      db.socialAccount,
      db.socialFollowers,
      db.trackedKeyword,
      db.keywordRank,
      db.competitor,
      db.adAccount,
      db.googleConnection,
      db.shopSettings,
    ] as unknown as { deleteMany(): Promise<unknown> }[])
      await t.deleteMany();
  });

  it("puts social posts, rankings and competitors against the period before", async () => {
    const acc = await db.socialAccount.create({
      data: {
        shop: SHOP,
        network: "instagram",
        accountId: "ig1",
        name: "Candle Co",
        token: "x",
      },
    });
    const post = (day: string, stats: object) =>
      db.socialPost.create({
        data: {
          shop: SHOP,
          accountId: acc.id,
          network: "instagram",
          caption: `Post ${day}`,
          status: "posted",
          stats: JSON.stringify(stats),
          createdAt: new Date(`${day}T12:00:00Z`),
        },
      });
    await post("2026-11-10", { likes: 50, comments: 10, reach: 1000 });
    await post("2026-11-12", { likes: 20, reach: 600 });
    await post("2026-11-03", { likes: 30, reach: 800 }); // The week before
    await post("2026-10-20", { likes: 999, reach: 9999 }); // Too early for either
    await db.socialFollowers.createMany({
      data: [
        { shop: SHOP, accountId: acc.id, day: "2026-11-07", followers: 1000 },
        { shop: SHOP, accountId: acc.id, day: "2026-11-14", followers: 1040 },
      ],
    });

    const k = await db.trackedKeyword.create({
      data: { shop: SHOP, keyword: "soy candles" },
    });
    const k2 = await db.trackedKeyword.create({
      data: { shop: SHOP, keyword: "gift candles" },
    });
    await db.keywordRank.createMany({
      data: [
        {
          shop: SHOP,
          keywordId: k.id,
          checkedAt: new Date("2026-11-07T06:00:00Z"),
          position: 12,
        },
        {
          shop: SHOP,
          keywordId: k2.id,
          checkedAt: new Date("2026-11-07T06:00:00Z"),
          position: 2,
        },
        {
          shop: SHOP,
          keywordId: k.id,
          checkedAt: new Date("2026-11-14T06:00:00Z"),
          position: 4,
        },
        {
          shop: SHOP,
          keywordId: k2.id,
          checkedAt: new Date("2026-11-14T06:00:00Z"),
          position: 2,
        },
      ],
    });

    const c = await db.competitor.create({
      data: { shop: SHOP, name: "Wick & Wax", url: "https://wickandwax.com" },
    });
    await db.trafficSnapshot.create({
      data: {
        competitorId: c.id,
        takenAt: new Date("2026-11-01T00:00:00Z"),
        market: "GB",
        organicTraffic: 1000,
        organicKeywords: 1,
        paidTraffic: 0,
        paidKeywords: 0,
        paidCostCents: 5000,
      },
    });
    await db.trafficSnapshot.create({
      data: {
        competitorId: c.id,
        takenAt: new Date("2026-11-13T00:00:00Z"),
        market: "GB",
        organicTraffic: 1200,
        organicKeywords: 1,
        paidTraffic: 0,
        paidKeywords: 0,
        paidCostCents: 6000,
      },
    });
    await db.competitorEvent.createMany({
      data: [
        {
          competitorId: c.id,
          kind: "price_down",
          message: "Cut",
          createdAt: new Date("2026-11-11T00:00:00Z"),
        },
        {
          competitorId: c.id,
          kind: "price_down",
          message: "Cut",
          createdAt: new Date("2026-11-12T00:00:00Z"),
        },
        {
          competitorId: c.id,
          kind: "launch",
          message: "New",
          createdAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    });

    const r = await performanceReport(SHOP, "7", { f: noFetch, now: NOW });
    expect(r.paid).toEqual([]);
    expect(r.google).toBeNull();
    expect(r.social?.current).toMatchObject({
      posts: 2,
      reach: 1600,
      engagements: 80,
    });
    expect(r.social?.previous).toMatchObject({
      posts: 1,
      reach: 800,
      engagements: 30,
    });
    expect(r.social?.top[0]).toMatchObject({
      text: "Post 2026-11-10",
      engagements: 60,
      account: "Candle Co",
    });
    expect(r.social?.followers).toEqual([
      { network: "instagram", name: "Candle Co", start: 1000, end: 1040 },
    ]);
    expect(r.search).toMatchObject({
      tracked: 2,
      top3: 1,
      top10: 2,
      prevTop3: 1,
      prevTop10: 1,
      movers: [{ keyword: "soy candles", from: 12, to: 4 }],
    });
    expect(r.competitors?.rows[0]).toMatchObject({
      name: "Wick & Wax",
      organicTraffic: 1200,
      prevOrganicTraffic: 1000,
      changes: 2,
    });
    expect(r.competitors?.events).toEqual([{ kind: "price_down", count: 2 }]);

    const email = reportEmail(r, "me@shop.com")!;
    expect(email.subject).toBe("Your performance report: 8 Nov to 14 Nov 2026");
    expect(email.text).toContain(
      "2 posts (+100%), reaching 1,600 (+100%), with 80 engagements (+167%)",
    );
    expect(email.text).toContain('"soy candles": 12 → 4');
    expect(email.html).toContain("Wick &amp; Wax");
  });

  it("reads paid social spend for both periods and keeps a broken account's reason", async () => {
    await saveAdAccounts(SHOP, [
      {
        network: "meta",
        accountId: "act_1",
        name: "Candle Co ads",
        currency: "GBP",
        token: "tok",
        expiresAt: null,
      },
      {
        network: "meta",
        accountId: "act_2",
        name: "Old ads",
        currency: "GBP",
        token: "tok",
        expiresAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
    const buy = (n: number) => [
      { action_type: "omni_purchase", value: String(n) },
    ];
    const f = (async (input: string | URL | Request) => {
      const url = String(input);
      const json = url.includes("/campaigns")
        ? {
            data: [
              {
                id: "c1",
                name: "Christmas",
                status: "ACTIVE",
                effective_status: "ACTIVE",
                account_id: "1",
              },
              {
                id: "c2",
                name: "Retargeting",
                status: "ACTIVE",
                effective_status: "ACTIVE",
                account_id: "1",
              },
            ],
          }
        : url.includes("2026-10-16") // This period
          ? {
              data: [
                {
                  campaign_id: "c1",
                  spend: "300",
                  clicks: "600",
                  actions: buy(12),
                  action_values: buy(1200),
                },
                {
                  campaign_id: "c2",
                  spend: "100",
                  clicks: "100",
                  actions: buy(2),
                  action_values: buy(200),
                },
              ],
            }
          : {
              data: [
                {
                  campaign_id: "c1",
                  spend: "200",
                  clicks: "400",
                  actions: buy(5),
                  action_values: buy(500),
                },
              ],
            };
      return new Response(JSON.stringify(json));
    }) as Fetch;
    const r = await performanceReport(SHOP, "30", { f, now: NOW });
    const [live, old] = r.paid;
    expect(live).toMatchObject({
      name: "Candle Co ads",
      error: null,
      current: { spend: 400, clicks: 700, purchases: 14, value: 1400 },
      previous: { spend: 200, value: 500 },
    });
    expect(live.campaigns.map((c) => [c.name, c.spend])).toEqual([
      ["Christmas", 300],
      ["Retargeting", 100],
    ]);
    expect(old.error).toContain("sign-in has run out");
    expect(r.social).toBeNull();
    expect(r.search).toBeNull();
    expect(r.competitors).toBeNull();
    expect(reportEmail(r, "me@shop.com")!.text).toContain(
      "Candle Co ads: £400.00 spent (+100%), 14 purchases, £1,400.00 in sales, 3.5× return",
    );
  });
});

describe("monthly report email", () => {
  let outbox: Email[] = [];
  const send = async (e: Email) => {
    outbox.push(e);
  };
  beforeEach(async () => {
    await db.shopSettings.deleteMany();
    await db.competitor.deleteMany();
    await db.adAccount.deleteMany();
    outbox = [];
  });

  it("goes on the 1st to shops that asked, once", async () => {
    await db.shopSettings.create({
      data: { shop: SHOP, alertEmail: "me@shop.com", reportOn: true },
    });
    await db.shopSettings.create({
      data: { shop: "other.myshopify.com", alertEmail: "no@shop.com" },
    });
    await db.competitor.create({
      data: { shop: SHOP, name: "Rival", url: "https://rival.com" },
    });
    const first = new Date("2026-12-01T08:00:00Z");
    expect(
      await sendMonthlyReports({ send, now: new Date("2026-12-02T08:00:00Z") }),
    ).toBe(0);
    expect(
      await sendMonthlyReports({ send, now: new Date("2026-12-01T06:00:00Z") }),
    ).toBe(0);
    expect(await sendMonthlyReports({ send, now: first })).toBe(1);
    expect(outbox[0]).toMatchObject({
      to: "me@shop.com",
      subject: "Your performance report: 1 Nov to 30 Nov 2026",
    });
    expect(outbox[0].unsubscribeUrl).toContain("list=report");
    expect(
      await sendMonthlyReports({ send, now: new Date("2026-12-01T09:00:00Z") }),
    ).toBe(0);
  });
});
