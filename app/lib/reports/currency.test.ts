import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { Email } from "../email/send.server";
import { NO_METRICS } from "../paidsocial/paid";
import {
  convert,
  inCurrency,
  parseCurrency,
  reportRange,
  type Rates,
  type Report,
} from "./report";
import { exchangeRates, forgetRates, parseRates } from "./rates.server";
import { reportEmail, sendMonthlyReports } from "./email.server";

const RATES: Rates = { date: "2026-11-13", perUsd: { GBP: 0.8, EUR: 0.9 } };

const report = (): Report => ({
  shop: "cur.myshopify.com",
  site: "candleco.co.uk",
  range: reportRange("last-month", new Date("2026-11-14T10:00:00Z")),
  createdAt: "2026-11-14T10:00:00Z",
  paid: [
    {
      network: "meta",
      name: "EU ads",
      currency: "EUR",
      error: null,
      current: {
        spend: 90,
        impressions: 1000,
        clicks: 50,
        purchases: 3,
        value: 360,
      },
      previous: { ...NO_METRICS, spend: 45, value: 90 },
      campaigns: [
        {
          name: "Autumn",
          spend: 90,
          impressions: 1000,
          clicks: 50,
          purchases: 3,
          value: 360,
        },
      ],
    },
    {
      network: "tiktok",
      name: "Odd ads",
      currency: "XYZ",
      error: null,
      current: { ...NO_METRICS, spend: 10 },
      previous: NO_METRICS,
      campaigns: [],
    },
  ],
  social: null,
  google: {
    checkedAt: null,
    analytics: {
      currency: "GBP",
      sessions: 100,
      users: 80,
      purchases: 4,
      revenue: 400,
      prevSessions: 90,
      prevRevenue: 200,
      prevPurchases: 2,
      channels: [{ name: "Direct", sessions: 50, revenue: 200 }],
    },
    ads: {
      currency: "USD",
      spend: 100,
      clicks: 10,
      conversions: 1,
      value: 300,
      prevSpend: 50,
      prevValue: 100,
    },
  },
  search: null,
  competitors: {
    rows: [
      {
        name: "Rival",
        organicTraffic: 10,
        prevOrganicTraffic: null,
        paidCostCents: 10000,
        prevPaidCostCents: 5000,
        liveAds: 1,
        newAds: 0,
        changes: 0,
      },
    ],
    events: [],
  },
});

describe("report currency", () => {
  it("converts through US dollars, and gives up without a rate", () => {
    expect(convert(90, "EUR", "GBP", RATES)).toBeCloseTo(80);
    expect(convert(100, "USD", "GBP", RATES)).toBeCloseTo(80);
    expect(convert(5, "GBP", "GBP", null)).toBe(5);
    expect(convert(5, "XYZ", "GBP", RATES)).toBeNull();
    expect(parseCurrency(" gbp ")).toBe("GBP");
    expect(parseCurrency("pounds")).toBeNull();
  });

  it("puts every amount in the chosen currency and lists what it couldn't convert", () => {
    const r = inCurrency(report(), "GBP", RATES);
    expect(r.paid[0]).toMatchObject({
      currency: "GBP",
      current: { clicks: 50 },
    });
    expect(r.paid[0].current.spend).toBeCloseTo(80);
    expect(r.paid[0].current.value).toBeCloseTo(320);
    expect(r.paid[0].previous.spend).toBeCloseTo(40);
    expect(r.paid[0].campaigns[0].spend).toBeCloseTo(80);
    expect(r.paid[1]).toMatchObject({
      currency: "XYZ",
      current: { spend: 10 },
    });
    expect(r.google?.analytics).toMatchObject({
      currency: "GBP",
      revenue: 400,
    });
    expect(r.google?.ads).toMatchObject({ currency: "GBP" });
    expect(r.google?.ads?.spend).toBeCloseTo(80);
    expect(r.google?.ads?.prevValue).toBeCloseTo(80);
    expect(r.competitors).toMatchObject({
      spendCurrency: "GBP",
      rows: [{ paidCostCents: 8000, prevPaidCostCents: 4000 }],
    });
    expect(r.unconverted).toEqual(["XYZ"]);
    expect(r.ratesDate).toBeNull();

    const usd = inCurrency(
      { ...report(), paid: [report().paid[0]] },
      "USD",
      RATES,
    );
    expect(usd.ratesDate).toBe("2026-11-13");
    expect(usd.paid[0].current.spend).toBeCloseTo(100);
    expect(usd.competitors?.rows[0].paidCostCents).toBe(10000);
    expect(reportEmail(usd, "me@shop.com")!.text).toContain(
      "EU ads: US$100.00 spent",
    );
  });

  it("reads Frankfurter's rates, keeping them for a while and older ones when it fails", async () => {
    forgetRates();
    expect(
      parseRates({
        amount: 1,
        base: "USD",
        date: "2026-11-13",
        rates: { GBP: 0.79, BAD: "x" },
      }),
    ).toEqual({ date: "2026-11-13", perUsd: { GBP: 0.79 } });
    expect(parseRates({ message: "not found" })).toBeNull();
    let calls = 0;
    const ok = (async () => {
      calls++;
      return new Response(
        JSON.stringify({ date: "2026-11-13", rates: { GBP: 0.79 } }),
      );
    }) as typeof fetch;
    const down = (async () => {
      calls++;
      return new Response("nope", { status: 503 });
    }) as typeof fetch;
    expect(await exchangeRates({ f: ok, now: 0 })).toEqual({
      date: "2026-11-13",
      perUsd: { GBP: 0.79 },
    });
    expect(await exchangeRates({ f: ok, now: 3600_000 })).not.toBeNull();
    expect(calls).toBe(1);
    expect((await exchangeRates({ f: down, now: 7 * 3600_000 }))?.date).toBe(
      "2026-11-13",
    );
    expect(calls).toBe(2);
    forgetRates();
    expect(await exchangeRates({ f: down, now: 0 })).toBeNull();
  });
});

describe("monthly report email currency", () => {
  beforeEach(async () => {
    await db.shopSettings.deleteMany();
  });

  it("uses the currency chosen on the Reports page", async () => {
    await db.shopSettings.create({
      data: {
        shop: "cur.myshopify.com",
        alertEmail: "me@shop.com",
        reportOn: true,
        reportCurrency: "GBP",
      },
    });
    const outbox: Email[] = [];
    const sent = await sendMonthlyReports({
      send: async (e) => {
        outbox.push(e);
      },
      now: new Date("2026-12-01T08:00:00Z"),
      build: async () => ({ ...report(), paid: [report().paid[0]] }),
      rates: async () => RATES,
    });
    expect(sent).toBe(1);
    expect(outbox[0].text).toContain("EU ads: £80.00 spent");
  });
});
