import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { seal } from "../social/seal.server";
import { ADS_SCOPE, GA_SCOPE, adsAccounts, adsProblem, adsRanges, connectGoogle, googleOverview, parseAnalytics, parseCampaigns, refreshGoogle, type Fetch } from "./google.server";

const SHOP = "google.myshopify.com";
const NOW = new Date("2026-10-19T09:00:00Z");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Answers each Google endpoint with the first handler whose key the URL contains.
const fake = (routes: Record<string, (body: unknown, headers: Headers) => unknown>): Fetch & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return json({ error: { message: `no route for ${url}` } }, 404);
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    const out = routes[key](body, new Headers(init?.headers));
    return out instanceof Response ? out : json(out);
  }) as Fetch & { calls: string[] };
  f.calls = calls;
  return f;
};

describe("Google Analytics and Ads", () => {
  beforeEach(async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev";
    await db.googleConnection.deleteMany({ where: { shop: SHOP } });
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  });

  it("reads Analytics totals for both periods, channels and landing pages", () => {
    const a = parseAnalytics({
      reports: [
        {
          metadata: { currencyCode: "GBP" },
          rows: [
            { dimensionValues: [{ value: "previous" }], metricValues: [{ value: "800" }, { value: "600" }, { value: "10" }, { value: "450.5" }] },
            { dimensionValues: [{ value: "current" }], metricValues: [{ value: "1000" }, { value: "700" }, { value: "12" }, { value: "520.25" }] },
          ],
        },
        { rows: [{ dimensionValues: [{ value: "Organic Search" }], metricValues: [{ value: "600" }, { value: "300" }] }] },
        { rows: [{ dimensionValues: [{ value: "/collections/gift-boxes" }], metricValues: [{ value: "250" }, { value: "4" }] }] },
      ],
    });
    expect(a).toEqual({
      currency: "GBP",
      current: { sessions: 1000, users: 700, purchases: 12, revenue: 520.25 },
      previous: { sessions: 800, users: 600, purchases: 10, revenue: 450.5 },
      channels: [{ name: "Organic Search", sessions: 600, revenue: 300 }],
      pages: [{ path: "/collections/gift-boxes", sessions: 250, purchases: 4 }],
    });
    expect(parseAnalytics({}).current).toEqual({ sessions: 0, users: 0, purchases: 0, revenue: 0 });
  });

  it("adds up campaigns and turns micros into money", () => {
    const camps = parseCampaigns([
      { campaign: { name: "Brand", status: "ENABLED" }, metrics: { costMicros: "2500000", clicks: "10", conversions: 1, conversionsValue: 40 } },
      { campaign: { name: "Shopping", status: "ENABLED" }, metrics: { costMicros: "12000000", clicks: "30", conversions: 2.5, conversionsValue: 90 } },
      { campaign: { name: "Brand", status: "ENABLED" }, metrics: { costMicros: "500000", clicks: "2" } },
    ]);
    expect(camps.map((c) => [c.name, c.spend, c.clicks, c.conversions, c.value])).toEqual([
      ["Shopping", 12, 30, 2.5, 90],
      ["Brand", 3, 12, 1, 40],
    ]);
  });

  it("compares the last 30 full days with the 30 before", () => {
    expect(adsRanges(NOW)).toEqual({ current: ["2026-09-19", "2026-10-18"], previous: ["2026-08-20", "2026-09-18"] });
  });

  it("explains Google Ads errors a merchant can act on", () => {
    const err = (code: string) => ({ error: { message: "x", details: [{ errors: [{ message: "raw", errorCode: { authorizationError: code } }] }] } });
    expect(adsProblem(err("DEVELOPER_TOKEN_NOT_APPROVED"), 403)).toMatch(/hasn't finished approving/);
    expect(adsProblem(err("SOMETHING_ELSE"), 400)).toBe("Google Ads: raw");
  });

  it("lists Ads accounts, including clients under a manager account", async () => {
    const f = fake({
      "customers:listAccessibleCustomers": () => ({ resourceNames: ["customers/1112223333", "customers/9998887777"] }),
      "customers/1112223333/googleAds:search": () => ({ results: [{ customer: { id: "1112223333", descriptiveName: "Gift Boxes", manager: false } }] }),
      "customers/9998887777/googleAds:search": (body, headers) =>
        String((body as { query: string }).query).includes("customer_client")
          ? (expect(headers.get("login-customer-id")).toBe("9998887777"),
            {
              results: [
                { customerClient: { id: "4445556666", descriptiveName: "Shop Two", manager: false, status: "ENABLED" } },
                { customerClient: { id: "9998887777", descriptiveName: "Agency", manager: true, status: "ENABLED" } },
              ],
            })
          : { results: [{ customer: { id: "9998887777", descriptiveName: "Agency", manager: true } }] },
    });
    expect(await adsAccounts("token", f)).toEqual([
      { id: "1112223333", name: "Gift Boxes", group: "", login: null },
      { id: "4445556666", name: "Shop Two", group: "Agency", login: "9998887777" },
    ]);
  });

  it("connects, then reads both and keeps an error per source", async () => {
    const signIn = fake({
      "oauth2.googleapis.com/token": () => ({ access_token: "a", refresh_token: "r", scope: `openid email ${GA_SCOPE} ${ADS_SCOPE}` }),
      userinfo: () => ({ email: "chris@example.com" }),
    });
    expect(await connectGoogle(SHOP, "code", signIn)).toBe("chris@example.com");
    await db.googleConnection.update({ where: { shop: SHOP }, data: { gaProperty: "properties/1", adsCustomer: "1112223333" } });

    const f = fake({
      "oauth2.googleapis.com/token": () => ({ access_token: "a" }),
      batchRunReports: () => ({ reports: [{ rows: [{ dimensionValues: [{ value: "current" }], metricValues: [{ value: "5" }, { value: "4" }, { value: "1" }, { value: "20" }] }] }, {}, {}] }),
      googleAds: () => json({ error: { message: "denied", details: [{ errors: [{ message: "denied", errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] } }, 403),
    });
    await refreshGoogle(SHOP, f, NOW);
    const o = await googleOverview(SHOP);
    expect(o?.analyticsAllowed && o.adsAllowed).toBe(true);
    expect(o?.report?.analytics?.current.sessions).toBe(5);
    expect(o?.report?.adsError).toMatch(/can't read that Google Ads account/);
    expect(o?.checkedAt).toBe(NOW.toISOString());
    expect(o?.running).toBe(false);
  });

  it("says to sign in again when Google has revoked access", async () => {
    await db.googleConnection.create({ data: { shop: SHOP, email: "x", refreshToken: seal("r"), scopes: GA_SCOPE, gaProperty: "properties/1" } });
    await refreshGoogle(SHOP, fake({ "oauth2.googleapis.com/token": () => json({ error: "invalid_grant" }, 400) }), NOW);
    expect((await googleOverview(SHOP))?.report?.analyticsError).toMatch(/Connect Google again/);
  });

  it("refuses a sign-in that allowed neither Analytics nor Ads", async () => {
    const f = fake({ "oauth2.googleapis.com/token": () => ({ access_token: "a", refresh_token: "r", scope: "openid email" }) });
    await expect(connectGoogle(SHOP, "code", f)).rejects.toThrow(/didn't tick/);
    expect(await googleOverview(SHOP)).toBeNull();
  });
});
