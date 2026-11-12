// The merchant's own paid social ads: Meta's Marketing API (Facebook and
// Instagram ads) and TikTok's API for Business. Reading campaigns and what
// they spent, and changing a campaign's budget or switching it on or off.
//
// Meta uses the same Meta app as social posting (META_APP_ID and
// META_APP_SECRET) but its own sign-in asking for ads_read and
// ads_management, through META_ADS_CONFIG_ID when the app is a Business app.
// TikTok ads need a separate TikTok for Business developer app:
// TIKTOK_ADS_APP_ID and TIKTOK_ADS_SECRET.

import { GRAPH, type Fetch } from "../social/networks.server";
import { ZERO_DECIMAL, type AdNetwork, type BudgetKind, type Campaign, type Metrics } from "./paid";

export type { Fetch };

const TIKTOK_ADS = "https://business-api.tiktok.com/open_api/v1.3";

export const adNetworkOn = (n: AdNetwork) =>
  n === "meta" ? !!(process.env.META_APP_ID && process.env.META_APP_SECRET) : !!(process.env.TIKTOK_ADS_APP_ID && process.env.TIKTOK_ADS_SECRET);

// Until Meta or TikTok grant the ads permissions, only people added to the
// apps can sign in, so the Connect buttons show only on Colourmedia's own and free
// stores. SOCIAL_APPROVED lists the approved ones, e.g. "meta-ads,tiktok-ads".
export const adNetworkApproved = (n: AdNetwork) =>
  (process.env.SOCIAL_APPROVED ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(`${n}-ads`);

export const adCallbackUrl = (n: AdNetwork) => `${process.env.SHOPIFY_APP_URL || ""}/paid/callback/${n}`;

export const META_AD_SCOPES = ["ads_read", "ads_management", "business_management"];

export function adAuthorizeUrl(n: AdNetwork, state: string) {
  if (n === "meta") {
    const config = process.env.META_ADS_CONFIG_ID;
    const ask: Record<string, string> = config ? { config_id: config, override_default_response_type: "true" } : { scope: META_AD_SCOPES.join(",") };
    const q = new URLSearchParams({ client_id: process.env.META_APP_ID ?? "", redirect_uri: adCallbackUrl(n), state, ...ask, response_type: "code" });
    return `https://www.facebook.com/v23.0/dialog/oauth?${q}`;
  }
  const q = new URLSearchParams({ app_id: process.env.TIKTOK_ADS_APP_ID ?? "", redirect_uri: adCallbackUrl(n), state });
  return `https://business-api.tiktok.com/portal/auth?${q}`;
}

export type ConnectedAdAccount = { network: AdNetwork; accountId: string; name: string; currency: string; token: string; expiresAt: Date | null };

// ---------- Meta ----------

type GraphError = { error?: { message?: string; error_user_msg?: string } };

async function graph<T>(f: Fetch, path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = `${GRAPH}${path}`;
  const body = new URLSearchParams(params);
  const res = method === "GET" ? await f(`${url}?${body}`, { signal: AbortSignal.timeout(30_000) }) : await f(url, { method, body, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || json.error) throw new Error(json.error?.error_user_msg || json.error?.message || `Meta answered ${res.status}`);
  return json;
}

// Meta counts budgets in hundredths of the currency, except for a few
// currencies without them.
const metaUnits = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100);

// Signs in, swaps the short token for one lasting about 60 days, and lists
// the ad accounts the person can use.
export async function connectMetaAds(code: string, f: Fetch = fetch, now = new Date()): Promise<ConnectedAdAccount[]> {
  const id = process.env.META_APP_ID ?? "";
  const secret = process.env.META_APP_SECRET ?? "";
  const short = await graph<{ access_token: string }>(f, "/oauth/access_token", { client_id: id, client_secret: secret, redirect_uri: adCallbackUrl("meta"), code });
  const long = await graph<{ access_token: string; expires_in?: number }>(f, "/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: id,
    client_secret: secret,
    fb_exchange_token: short.access_token,
  });
  const expiresAt = new Date(now.getTime() + (long.expires_in ?? 60 * 86400) * 1000);
  const list = await graph<{ data?: { id: string; name?: string; currency?: string; account_status?: number }[] }>(f, "/me/adaccounts", {
    fields: "id,name,currency,account_status",
    access_token: long.access_token,
    limit: "100",
  });
  // 101 is a closed account.
  return (list.data ?? [])
    .filter((a) => a.account_status !== 101)
    .map((a) => ({ network: "meta" as const, accountId: a.id, name: a.name || a.id, currency: a.currency || "USD", token: long.access_token, expiresAt }));
}

const META_DELIVERY: Record<string, string> = {
  ACTIVE: "Running",
  PAUSED: "Paused",
  IN_PROCESS: "Starting",
  WITH_ISSUES: "Has issues",
  PENDING_REVIEW: "In review",
  DISAPPROVED: "Not approved",
  PENDING_BILLING_INFO: "Needs payment details",
  PREAPPROVED: "Approved, not started",
};

type MetaCampaign = { id: string; name: string; status: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; account_id?: string };

function metaCampaign(c: MetaCampaign, currency: string): Campaign {
  const units = metaUnits(currency);
  const daily = Number(c.daily_budget ?? 0);
  const lifetime = Number(c.lifetime_budget ?? 0);
  const budgetKind: BudgetKind = daily > 0 ? "daily" : lifetime > 0 ? "lifetime" : "none";
  return {
    id: c.id,
    name: c.name,
    on: c.status === "ACTIVE",
    delivery: META_DELIVERY[c.effective_status] ?? c.effective_status.toLowerCase().replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase()),
    budgetKind,
    budget: budgetKind === "daily" ? daily / units : budgetKind === "lifetime" ? lifetime / units : null,
  };
}

const CAMPAIGN_FIELDS = "id,name,status,effective_status,daily_budget,lifetime_budget,account_id";

export async function metaCampaigns(accountId: string, token: string, currency: string, f: Fetch = fetch): Promise<Campaign[]> {
  const res = await graph<{ data?: MetaCampaign[] }>(f, `/${accountId}/campaigns`, { fields: CAMPAIGN_FIELDS, access_token: token, limit: "200" });
  return (res.data ?? []).filter((c) => c.effective_status !== "ARCHIVED" && c.effective_status !== "DELETED").map((c) => metaCampaign(c, currency));
}

type MetaAction = { action_type: string; value: string };
type MetaInsight = { campaign_id?: string; spend?: string; impressions?: string; clicks?: string; actions?: MetaAction[]; action_values?: MetaAction[] };

// Purchases are counted once, preferring Meta's combined count across the website, app and shops.
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const pick = (list: MetaAction[] | undefined) => {
  for (const t of PURCHASE_TYPES) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
};

function metaMetrics(i: MetaInsight): Metrics {
  return { spend: Number(i.spend) || 0, impressions: Number(i.impressions) || 0, clicks: Number(i.clicks) || 0, purchases: pick(i.actions), value: pick(i.action_values) };
}

// Each campaign's figures between two days (YYYY-MM-DD), by campaign id.
export async function metaInsights(accountId: string, token: string, since: string, until: string, f: Fetch = fetch): Promise<Map<string, Metrics>> {
  const res = await graph<{ data?: MetaInsight[] }>(f, `/${accountId}/insights`, {
    level: "campaign",
    fields: "campaign_id,spend,impressions,clicks,actions,action_values",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  return new Map((res.data ?? []).filter((i) => i.campaign_id).map((i) => [i.campaign_id!, metaMetrics(i)]));
}

// One campaign, checked to belong to the account before anything changes.
async function metaCampaignIn(accountId: string, campaignId: string, token: string, currency: string, f: Fetch) {
  const c = await graph<MetaCampaign>(f, `/${encodeURIComponent(campaignId)}`, { fields: CAMPAIGN_FIELDS, access_token: token });
  if (`act_${c.account_id}` !== accountId) throw new Error("That campaign isn't in this ad account.");
  return metaCampaign(c, currency);
}

export async function metaSetStatus(accountId: string, campaignId: string, on: boolean, token: string, currency: string, f: Fetch = fetch) {
  const before = await metaCampaignIn(accountId, campaignId, token, currency, f);
  await graph(f, `/${encodeURIComponent(campaignId)}`, { status: on ? "ACTIVE" : "PAUSED", access_token: token }, "POST");
  return before;
}

export async function metaSetBudget(accountId: string, campaignId: string, amount: number, token: string, currency: string, f: Fetch = fetch) {
  const before = await metaCampaignIn(accountId, campaignId, token, currency, f);
  if (before.budgetKind === "none") throw new Error("This campaign's budget is set on each ad set. Change it in Meta Ads Manager.");
  const field = before.budgetKind === "daily" ? "daily_budget" : "lifetime_budget";
  await graph(f, `/${encodeURIComponent(campaignId)}`, { [field]: String(Math.round(amount * metaUnits(currency))), access_token: token }, "POST");
  return before;
}

// ---------- TikTok ----------

type TikTokAnswer<T> = { code?: number; message?: string; data?: T };

async function tiktok<T>(f: Fetch, token: string | null, path: string, params: Record<string, unknown>, method: "GET" | "POST" = "GET"): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["Access-Token"] = token;
  let url = `${TIKTOK_ADS}${path}`;
  let body: string | undefined;
  if (method === "GET") {
    const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
    url = `${url}?${q}`;
  } else body = JSON.stringify(params);
  const res = await f(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as TikTokAnswer<T>;
  if (!res.ok || json.code !== 0) throw new Error(json.message || `TikTok answered ${res.status}`);
  return json.data as T;
}

// TikTok's sign-in gives one long-lasting token for every advertiser account the person allowed.
export async function connectTikTokAds(authCode: string, f: Fetch = fetch): Promise<ConnectedAdAccount[]> {
  const t = await tiktok<{ access_token?: string; advertiser_ids?: string[] }>(
    f,
    null,
    "/oauth2/access_token/",
    { app_id: process.env.TIKTOK_ADS_APP_ID ?? "", secret: process.env.TIKTOK_ADS_SECRET ?? "", auth_code: authCode },
    "POST",
  );
  const token = t?.access_token;
  const ids = t?.advertiser_ids ?? [];
  if (!token) throw new Error("TikTok didn't send an access token.");
  if (!ids.length) return [];
  const info = await tiktok<{ list?: { advertiser_id: string; name?: string; currency?: string }[] }>(f, token, "/advertiser/info/", {
    advertiser_ids: ids,
    fields: ["advertiser_id", "name", "currency"],
  });
  return ids.map((id) => {
    const a = info?.list?.find((x) => x.advertiser_id === id);
    return { network: "tiktok" as const, accountId: id, name: a?.name || `TikTok ads ${id}`, currency: a?.currency || "USD", token, expiresAt: null };
  });
}

const TIKTOK_DELIVERY: Record<string, string> = {
  CAMPAIGN_STATUS_ENABLE: "Running",
  CAMPAIGN_STATUS_DISABLE: "Paused",
  CAMPAIGN_STATUS_BUDGET_EXCEED: "Budget used up",
  CAMPAIGN_STATUS_ADVERTISER_AUDIT: "Account in review",
  CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY: "Account not approved",
  CAMPAIGN_STATUS_ADVERTISER_ACCOUNT_BALANCE_INSUFFICIENT: "Account balance too low",
  CAMPAIGN_STATUS_NOT_DELETE: "Running",
};

type TikTokCampaign = { campaign_id: string; campaign_name: string; operation_status?: string; secondary_status?: string; budget?: number; budget_mode?: string };

function tiktokCampaign(c: TikTokCampaign): Campaign {
  const budgetKind: BudgetKind = c.budget_mode === "BUDGET_MODE_DAY" || c.budget_mode === "BUDGET_MODE_DYNAMIC_DAILY_BUDGET" ? "daily" : c.budget_mode === "BUDGET_MODE_TOTAL" ? "lifetime" : "none";
  const status = c.secondary_status ?? "";
  return {
    id: c.campaign_id,
    name: c.campaign_name,
    on: c.operation_status === "ENABLE",
    delivery: TIKTOK_DELIVERY[status] ?? (c.operation_status === "ENABLE" ? "Running" : "Paused"),
    budgetKind,
    budget: budgetKind === "none" ? null : Number(c.budget ?? 0),
  };
}

const TIKTOK_FIELDS = ["campaign_id", "campaign_name", "operation_status", "secondary_status", "budget", "budget_mode"];

async function tiktokCampaignList(advertiserId: string, token: string, f: Fetch, ids?: string[]) {
  const res = await tiktok<{ list?: TikTokCampaign[] }>(f, token, "/campaign/get/", {
    advertiser_id: advertiserId,
    fields: TIKTOK_FIELDS,
    page_size: "1000",
    ...(ids ? { filtering: { campaign_ids: ids } } : {}),
  });
  return (res?.list ?? []).filter((c) => c.secondary_status !== "CAMPAIGN_STATUS_DELETE");
}

export async function tiktokCampaigns(advertiserId: string, token: string, f: Fetch = fetch): Promise<Campaign[]> {
  return (await tiktokCampaignList(advertiserId, token, f)).map(tiktokCampaign);
}

type TikTokRow = { dimensions?: { campaign_id?: string }; metrics?: Record<string, string> };

export async function tiktokInsights(advertiserId: string, token: string, since: string, until: string, f: Fetch = fetch): Promise<Map<string, Metrics>> {
  const res = await tiktok<{ list?: TikTokRow[] }>(f, token, "/report/integrated/get/", {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: ["campaign_id"],
    metrics: ["spend", "impressions", "clicks", "complete_payment", "complete_payment_roas"],
    start_date: since,
    end_date: until,
    page_size: "1000",
  });
  const out = new Map<string, Metrics>();
  for (const r of res?.list ?? []) {
    const id = r.dimensions?.campaign_id;
    const m = r.metrics ?? {};
    if (!id) continue;
    const spend = Number(m.spend) || 0;
    out.set(id, { spend, impressions: Number(m.impressions) || 0, clicks: Number(m.clicks) || 0, purchases: Number(m.complete_payment) || 0, value: spend * (Number(m.complete_payment_roas) || 0) });
  }
  return out;
}

async function tiktokCampaignIn(advertiserId: string, campaignId: string, token: string, f: Fetch) {
  const hit = (await tiktokCampaignList(advertiserId, token, f, [campaignId])).find((c) => c.campaign_id === campaignId);
  if (!hit) throw new Error("That campaign isn't in this ad account.");
  return tiktokCampaign(hit);
}

export async function tiktokSetStatus(advertiserId: string, campaignId: string, on: boolean, token: string, f: Fetch = fetch) {
  const before = await tiktokCampaignIn(advertiserId, campaignId, token, f);
  await tiktok(f, token, "/campaign/status/update/", { advertiser_id: advertiserId, campaign_ids: [campaignId], operation_status: on ? "ENABLE" : "DISABLE" }, "POST");
  return before;
}

export async function tiktokSetBudget(advertiserId: string, campaignId: string, amount: number, token: string, f: Fetch = fetch) {
  const before = await tiktokCampaignIn(advertiserId, campaignId, token, f);
  if (before.budgetKind === "none") throw new Error("This campaign's budget is set on each ad group. Change it in TikTok Ads Manager.");
  await tiktok(f, token, "/campaign/update/", { advertiser_id: advertiserId, campaign_id: campaignId, budget: amount }, "POST");
  return before;
}
