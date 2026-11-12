import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { Email } from "../email/send.server";
import { adAuthorizeUrl, connectMetaAds, connectTikTokAds, type Fetch } from "./networks.server";
import { checkSpendLimits, paidOverview, saveAdAccounts, setCampaignBudget, setCampaignOn, setSpendLimit } from "./paid.server";
import { periodDates } from "./paid";

const SHOP = "paid.myshopify.com";
const NOW = new Date("2026-11-12T09:00:00Z");

type Call = { url: string; method: string; body: string; token: string | null };

// Answers each request from a list of [method url pattern, JSON] pairs, keeping what was sent.
function fakeFetch(routes: [RegExp, unknown][], calls: Call[]): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: String(init?.body ?? ""), token: new Headers(init?.headers).get("access-token") });
    const hit = routes.find(([re]) => re.test(`${method} ${url}`));
    return new Response(JSON.stringify(hit ? hit[1] : { error: { message: `unexpected ${method} ${url}` } }), { status: hit ? 200 : 400 });
  }) as Fetch;
}

const metaCampaignList = {
  data: [
    { id: "c1", name: "Spring sale", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "2500", account_id: "111" },
    { id: "c2", name: "Retargeting", status: "PAUSED", effective_status: "PAUSED", lifetime_budget: "50000", account_id: "111" },
    { id: "c3", name: "Ad set budgets", status: "ACTIVE", effective_status: "ACTIVE", account_id: "111" },
    { id: "c4", name: "Old", status: "PAUSED", effective_status: "ARCHIVED", account_id: "111" },
  ],
};
const metaInsightList = {
  data: [
    {
      campaign_id: "c1",
      spend: "120.50",
      impressions: "10000",
      clicks: "300",
      actions: [
        { action_type: "link_click", value: "280" },
        { action_type: "omni_purchase", value: "6" },
        { action_type: "purchase", value: "6" },
      ],
      action_values: [{ action_type: "omni_purchase", value: "480" }],
    },
    { campaign_id: "c3", spend: "30", impressions: "2000", clicks: "40" },
  ],
};

async function metaAccount(extra: Partial<{ monthlyLimit: number; limitPause: boolean }> = {}) {
  await saveAdAccounts(SHOP, [{ network: "meta", accountId: "act_111", name: "Shop ads", currency: "GBP", token: "meta-token", expiresAt: new Date(NOW.getTime() + 50 * 86400_000) }]);
  return db.adAccount.update({ where: { shop_network_accountId: { shop: SHOP, network: "meta", accountId: "act_111" } }, data: extra });
}

describe("paid social ads", () => {
  beforeEach(async () => {
    await db.adChange.deleteMany({ where: { shop: SHOP } });
    await db.adAccount.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("asks Meta for the ads permissions, and TikTok through its business sign-in", () => {
    process.env.META_APP_ID = "app1";
    process.env.TIKTOK_ADS_APP_ID = "tt1";
    delete process.env.META_ADS_CONFIG_ID;
    expect(new URL(adAuthorizeUrl("meta", "s")).searchParams.get("scope")).toBe("ads_read,ads_management,business_management");
    const tt = new URL(adAuthorizeUrl("tiktok", "s"));
    expect([tt.host, tt.searchParams.get("app_id"), tt.searchParams.get("redirect_uri")]).toEqual(["business-api.tiktok.com", "tt1", "/paid/callback/tiktok"]);
  });

  it("connects the Meta ad accounts with a long-lived token, leaving out closed ones", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/oauth\/access_token\?.*code=abc/, { access_token: "short" }],
        [/oauth\/access_token\?.*fb_exchange_token=short/, { access_token: "long", expires_in: 5184000 }],
        [/me\/adaccounts/, { data: [{ id: "act_111", name: "Shop ads", currency: "GBP", account_status: 1 }, { id: "act_222", name: "Closed", currency: "GBP", account_status: 101 }] }],
      ],
      calls,
    );
    const accounts = await connectMetaAds("abc", f, NOW);
    expect(accounts).toEqual([{ network: "meta", accountId: "act_111", name: "Shop ads", currency: "GBP", token: "long", expiresAt: new Date(NOW.getTime() + 5184000_000) }]);
  });

  it("connects every TikTok advertiser the merchant allowed", async () => {
    process.env.TIKTOK_ADS_SECRET = "sec";
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/POST .*oauth2\/access_token/, { code: 0, data: { access_token: "tt-token", advertiser_ids: ["900", "901"] } }],
        [/GET .*advertiser\/info/, { code: 0, data: { list: [{ advertiser_id: "900", name: "Shop TikTok", currency: "EUR" }] } }],
      ],
      calls,
    );
    const accounts = await connectTikTokAds("code1", f);
    expect(accounts.map((a) => [a.accountId, a.name, a.currency, a.token])).toEqual([
      ["900", "Shop TikTok", "EUR", "tt-token"],
      ["901", "TikTok ads 901", "USD", "tt-token"],
    ]);
    expect(JSON.parse(calls[0].body)).toEqual({ app_id: "tt1", secret: "sec", auth_code: "code1" });
    expect(calls[1].token).toBe("tt-token");
  });

  it("shows each campaign's budget, spend and purchases, running ones first", async () => {
    await metaAccount();
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/act_111\/campaigns/, metaCampaignList],
        [/act_111\/insights/, metaInsightList],
      ],
      calls,
    );
    const [a] = await paidOverview(SHOP, "7", { f, now: NOW });
    expect(a.error).toBeNull();
    expect(a.campaigns.map((c) => [c.name, c.on, c.budgetKind, c.budget, c.spend, c.purchases, c.value])).toEqual([
      ["Spring sale", true, "daily", 25, 120.5, 6, 480],
      ["Ad set budgets", true, "none", null, 30, 0, 0],
      ["Retargeting", false, "lifetime", 500, 0, 0, 0],
    ]);
    expect(a.totals).toEqual({ spend: 150.5, impressions: 12000, clicks: 340, purchases: 6, value: 480 });
    const insight = new URL(calls.find((c) => c.url.includes("insights"))!.url);
    expect(JSON.parse(insight.searchParams.get("time_range")!)).toEqual({ since: "2026-11-06", until: "2026-11-12" });
  });

  it("asks to sign in again once Meta's token has run out", async () => {
    await metaAccount();
    const [a] = await paidOverview(SHOP, "30", { f: fakeFetch([], []), now: new Date(NOW.getTime() + 60 * 86400_000) });
    expect(a.error).toBe("Your Facebook and Instagram sign-in has run out. Press Connect again to carry on.");
  });

  it("changes a Meta budget in hundredths, logs it, and stops an accidental extra zero", async () => {
    const acc = await metaAccount();
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/GET .*act_111\/campaigns/, metaCampaignList],
        [/GET .*\/c1\?/, metaCampaignList.data[0]],
        [/POST .*\/c1$/, { success: true }],
      ],
      calls,
    );
    expect(await setCampaignBudget(SHOP, acc.id, "c1", 250, { f, now: NOW })).toMatchObject({ error: expect.stringContaining("more than 5 times") });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(await setCampaignBudget(SHOP, acc.id, "c1", 40.004, { f, now: NOW })).toEqual({ ok: true });
    const post = calls.find((c) => c.method === "POST")!;
    expect(new URLSearchParams(post.body).get("daily_budget")).toBe("4000");
    const [change] = await db.adChange.findMany({ where: { shop: SHOP } });
    expect([change.kind, change.before, change.after, change.by]).toEqual(["budget", "£25.00 a day", "£40.00 a day", "you"]);
  });

  it("won't touch a campaign from another ad account, or another shop's account", async () => {
    const acc = await metaAccount();
    const f = fakeFetch([[/GET .*\/c9\?/, { id: "c9", name: "Not ours", status: "ACTIVE", effective_status: "ACTIVE", account_id: "999" }]], []);
    expect(await setCampaignOn(SHOP, acc.id, "c9", false, { f, now: NOW })).toMatchObject({ error: expect.stringContaining("isn't in this ad account") });
    expect(await setCampaignOn("other.myshopify.com", acc.id, "c1", false, { f, now: NOW })).toMatchObject({ error: expect.stringContaining("isn't connected") });
  });

  it("pauses and restarts TikTok campaigns", async () => {
    await saveAdAccounts(SHOP, [{ network: "tiktok", accountId: "900", name: "Shop TikTok", currency: "EUR", token: "tt-token", expiresAt: null }]);
    const acc = await db.adAccount.findFirstOrThrow({ where: { shop: SHOP, network: "tiktok" } });
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/GET .*campaign\/get/, { code: 0, data: { list: [{ campaign_id: "t1", campaign_name: "Reels push", operation_status: "ENABLE", secondary_status: "CAMPAIGN_STATUS_ENABLE", budget: 30, budget_mode: "BUDGET_MODE_DAY" }] } }],
        [/POST .*campaign\/status\/update/, { code: 0, data: {} }],
      ],
      calls,
    );
    expect(await setCampaignOn(SHOP, acc.id, "t1", false, { f, now: NOW })).toEqual({ ok: true });
    expect(JSON.parse(calls.find((c) => c.method === "POST")!.body)).toEqual({ advertiser_id: "900", campaign_ids: ["t1"], operation_status: "DISABLE" });
    expect(calls[0].token).toBe("tt-token");
  });

  it("emails at 80% and at the limit once each month, pausing campaigns when asked", async () => {
    const acc = await metaAccount();
    await setSpendLimit(SHOP, acc.id, 200, true);
    await db.shopSettings.create({ data: { shop: SHOP, alertEmail: "owner@example.com" } });
    const sent: Email[] = [];
    const send = async (e: Email) => void sent.push(e);
    const spending = (spend: string) => {
      const calls: Call[] = [];
      const f = fakeFetch(
        [
          [/GET .*act_111\/insights/, { data: [{ campaign_id: "c1", spend }] }],
          [/GET .*act_111\/campaigns/, metaCampaignList],
          [/GET .*\/c[13]\?/, metaCampaignList.data[0]],
          [/POST .*\/c[13]$/, { success: true }],
        ],
        calls,
      );
      return { f, calls };
    };

    let run = spending("170");
    await checkSpendLimits({ f: run.f, send, now: NOW });
    expect(sent.map((e) => e.subject)).toEqual(["Shop ads (Facebook and Instagram) has spent 85% of its monthly ad limit"]);
    expect(run.calls.some((c) => c.method === "POST")).toBe(false);

    // Not checked again within the hour, and not emailed twice for the same level.
    run = spending("175");
    await checkSpendLimits({ f: run.f, send, now: new Date(NOW.getTime() + 10 * 60_000) });
    await checkSpendLimits({ f: run.f, send, now: new Date(NOW.getTime() + 2 * 3600_000) });
    expect(sent).toHaveLength(1);

    run = spending("205");
    await checkSpendLimits({ f: run.f, send, now: new Date(NOW.getTime() + 4 * 3600_000) });
    expect(sent[1].subject).toBe("Shop ads (Facebook and Instagram) has reached its monthly ad limit");
    expect(sent[1].text).toContain("paused these 2 campaigns");
    expect(run.calls.filter((c) => c.method === "POST").map((c) => new URLSearchParams(c.body).get("status"))).toEqual(["PAUSED", "PAUSED"]);
    expect(await db.adChange.count({ where: { shop: SHOP, by: "limit", kind: "pause" } })).toBe(2);

    // Switched back on by the merchant: left alone for the rest of the month.
    run = spending("260");
    await checkSpendLimits({ f: run.f, send, now: new Date(NOW.getTime() + 6 * 3600_000) });
    expect(run.calls.some((c) => c.method === "POST")).toBe(false);
    expect(sent).toHaveLength(2);
    expect((await db.adAccount.findUniqueOrThrow({ where: { id: acc.id } })).monthSpend).toBe(260);
  });

  it("covers whole days for each period", () => {
    expect(periodDates("month", NOW)).toEqual({ since: "2026-11-01", until: "2026-11-12" });
    expect(periodDates("30", NOW)).toEqual({ since: "2026-10-14", until: "2026-11-12" });
  });
});
