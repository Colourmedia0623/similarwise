import { Prisma } from "@prisma/client";
import db from "../../db.server";
import { seal, unseal } from "../social/seal.server";
import { formatCustomerId, type AdsTotals, type Totals } from "./google";

export { formatCustomerId, type AdsTotals, type Totals } from "./google";

// The merchant's own Google Analytics and Google Ads figures, from one Google
// sign-in: visits, where they come from, top landing pages and sales from an
// Analytics (GA4) property, and spend, clicks, conversions and campaigns from
// a Google Ads account. Off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
// are set; Google Ads also needs GOOGLE_ADS_DEVELOPER_TOKEN.

export type Fetch = typeof fetch;

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const GA_ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const GA_DATA = "https://analyticsdata.googleapis.com/v1beta";
const ads = () => `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || "v26"}`;

export const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

const DAY = 86400_000;
const STUCK = 30 * 60_000;
const MIN_GAP = 15 * 60_000; // Between refreshes the merchant starts
const MAX_ADS_ACCOUNTS = 20;

export const googleOn = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const adsOn = () => googleOn() && !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

// Until Google has verified SimilarWise's sign-in, only the test users added
// to its Google Cloud project can sign in, so the Connect button is shown only
// to Colourmedia's own stores. GOOGLE_APPROVED=true opens it to everyone.
export const googleApproved = () => process.env.GOOGLE_APPROVED === "true";

export const googleCallbackUrl = () => `${process.env.SHOPIFY_APP_URL || ""}/google/callback`;

export function googleAuthorizeUrl(state: string) {
  const scopes = ["openid", "email", GA_SCOPE, ...(adsOn() ? [ADS_SCOPE] : [])];
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleCallbackUrl(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    // Asks again each time so Google always returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH}?${q}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };

async function token(f: Fetch, params: Record<string, string>) {
  const res = await f(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new Error("Google has signed SimilarWise out. Press Connect Google again.");
    throw new Error(json.error_description || json.error || `Google answered ${res.status}`);
  }
  return json;
}

// The access token for one call, from the stored refresh token.
export const accessToken = async (refreshToken: string, f: Fetch = fetch) => (await token(f, { grant_type: "refresh_token", refresh_token: refreshToken })).access_token!;

// Signs the merchant in and keeps the refresh token. Choosing the Analytics
// property and Ads account comes after, on the Google page.
export async function connectGoogle(shop: string, code: string, f: Fetch = fetch) {
  const t = await token(f, { code, grant_type: "authorization_code", redirect_uri: googleCallbackUrl() });
  if (!t.refresh_token) throw new Error("Google didn't give SimilarWise ongoing access. Press Connect Google again and allow it.");
  const scopes = t.scope ?? "";
  if (!scopes.includes(GA_SCOPE) && !scopes.includes(ADS_SCOPE))
    throw new Error("You didn't tick Analytics or Google Ads on Google's sign-in page, so there's nothing to read. Press Connect Google again and tick them.");
  const info = await f(USERINFO, { headers: { authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(30_000) })
    .then((r) => r.json() as Promise<{ email?: string }>)
    .catch(() => ({ email: undefined }));
  const data = { email: info.email ?? "Google account", refreshToken: seal(t.refresh_token), scopes, report: Prisma.DbNull, checkedAt: null };
  // A new sign-in may be a different Google account, so the choices start again.
  const reset = { gaProperty: null, gaName: null, adsCustomer: null, adsLogin: null, adsName: null };
  await db.googleConnection.upsert({ where: { shop }, update: { ...data, ...reset }, create: { shop, ...data } });
  return info.email ?? null;
}

export async function disconnectGoogle(shop: string, f: Fetch = fetch) {
  const row = await db.googleConnection.findUnique({ where: { shop } });
  if (!row) return;
  await db.googleConnection.delete({ where: { shop } });
  // Tells Google too, so the access is gone from the merchant's account.
  await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(row.refreshToken))}`, { method: "POST", signal: AbortSignal.timeout(15_000) }).catch(() => {});
}

// ---- Google Analytics ----------------------------------------------------

async function gaCall<T>(f: Fetch, access: string, url: string, body?: object): Promise<T> {
  const res = await f(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${access}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok || json.error) {
    if (res.status === 403 && /has not been used|is disabled/i.test(json.error?.message ?? ""))
      throw new Error("The Google Analytics APIs aren't switched on for SimilarWise's Google Cloud project yet.");
    if (res.status === 403) throw new Error("This Google account can't read that Analytics property. Pick another, or connect the account that can.");
    throw new Error(`Google Analytics: ${json.error?.message ?? `answered ${res.status}`}`);
  }
  return json;
}

export type Choice = { id: string; name: string; group: string; login?: string | null };

type AccountSummaries = { accountSummaries?: { displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[]; nextPageToken?: string };

export function parseProperties(json: AccountSummaries): Choice[] {
  return (json.accountSummaries ?? []).flatMap((a) =>
    (a.propertySummaries ?? []).filter((p) => p.property).map((p) => ({ id: p.property!, name: p.displayName || p.property!, group: a.displayName || "" })),
  );
}

export async function gaProperties(access: string, f: Fetch = fetch): Promise<Choice[]> {
  const out: Choice[] = [];
  let page = "";
  for (let i = 0; i < 5; i++) {
    const json = await gaCall<AccountSummaries>(f, access, `${GA_ADMIN}/accountSummaries?pageSize=200${page ? `&pageToken=${page}` : ""}`);
    out.push(...parseProperties(json));
    if (!json.nextPageToken) break;
    page = encodeURIComponent(json.nextPageToken);
  }
  return out;
}

export type Analytics = {
  currency: string;
  current: Totals;
  previous: Totals;
  channels: { name: string; sessions: number; revenue: number }[];
  pages: { path: string; sessions: number; purchases: number }[];
};

type GaRow = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type GaReport = { rows?: GaRow[]; metadata?: { currencyCode?: string } };

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const metric = (r: GaRow, i: number) => n(r.metricValues?.[i]?.value);
const dim = (r: GaRow, i: number) => r.dimensionValues?.[i]?.value ?? "";

const TOTALS = ["sessions", "totalUsers", "ecommercePurchases", "purchaseRevenue"].map((name) => ({ name }));
const LAST_28 = { startDate: "28daysAgo", endDate: "yesterday", name: "current" };
const PRIOR_28 = { startDate: "56daysAgo", endDate: "29daysAgo", name: "previous" };

export const gaRequests = () => [
  { dateRanges: [LAST_28, PRIOR_28], metrics: TOTALS },
  {
    dateRanges: [LAST_28],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "purchaseRevenue" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  },
  {
    dateRanges: [LAST_28],
    dimensions: [{ name: "landingPage" }],
    metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  },
];

const zero = (): Totals => ({ sessions: 0, users: 0, purchases: 0, revenue: 0 });

// The three reports of gaRequests, in order. With two date ranges and no other
// dimension, Google names each row's range in its only dimension.
export function parseAnalytics(json: { reports?: GaReport[] }): Analytics {
  const [totals, channels, pages] = json.reports ?? [];
  const pick = (name: string) => {
    const r = (totals?.rows ?? []).find((row) => dim(row, 0) === name);
    return r ? { sessions: metric(r, 0), users: metric(r, 1), purchases: metric(r, 2), revenue: metric(r, 3) } : zero();
  };
  return {
    currency: totals?.metadata?.currencyCode || channels?.metadata?.currencyCode || "USD",
    current: pick("current"),
    previous: pick("previous"),
    channels: (channels?.rows ?? []).map((r) => ({ name: dim(r, 0) || "(other)", sessions: metric(r, 0), revenue: metric(r, 1) })),
    pages: (pages?.rows ?? []).map((r) => ({ path: dim(r, 0) || "(not set)", sessions: metric(r, 0), purchases: metric(r, 1) })),
  };
}

export async function gaReport(access: string, property: string, f: Fetch = fetch) {
  return parseAnalytics(await gaCall(f, access, `${GA_DATA}/${property}:batchRunReports`, { requests: gaRequests() }));
}

// ---- Google Ads ----------------------------------------------------------

type AdsError = { error?: { message?: string; details?: { errors?: { message?: string; errorCode?: Record<string, string> }[] }[] } };

// Google's reasons, in words a merchant can act on.
export function adsProblem(json: AdsError, status: number) {
  const first = json.error?.details?.flatMap((d) => d.errors ?? [])[0];
  const code = Object.values(first?.errorCode ?? {})[0] ?? "";
  if (code === "DEVELOPER_TOKEN_NOT_APPROVED" || code === "DEVELOPER_TOKEN_PROHIBITED")
    return "Google hasn't finished approving SimilarWise for Google Ads yet, so real accounts can't be read.";
  if (code === "USER_PERMISSION_DENIED") return "This Google account can't read that Google Ads account. Pick another, or connect the account that can.";
  if (code === "CUSTOMER_NOT_ENABLED") return "That Google Ads account isn't active (it may be cancelled or not set up yet).";
  return `Google Ads: ${first?.message || json.error?.message || `answered ${status}`}`;
}

async function adsCall<T>(f: Fetch, access: string, path: string, body?: object, login?: string | null): Promise<T> {
  const res = await f(`${ads()}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${access}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
      ...(login ? { "login-customer-id": login } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & AdsError;
  if (!res.ok || json.error) throw new Error(adsProblem(json, res.status));
  return json;
}

type Row = Record<string, Record<string, unknown> | undefined>;
const search = (f: Fetch, access: string, customer: string, query: string, login?: string | null) =>
  adsCall<{ results?: Row[] }>(f, access, `/customers/${customer}/googleAds:search`, { query }, login).then((r) => r.results ?? []);

// The Ads accounts the merchant can read: the ones they sign in to directly,
// and the client accounts under any manager account they hold.
export async function adsAccounts(access: string, f: Fetch = fetch): Promise<Choice[]> {
  const { resourceNames = [] } = await adsCall<{ resourceNames?: string[] }>(f, access, "/customers:listAccessibleCustomers");
  const out: Choice[] = [];
  for (const name of resourceNames.slice(0, MAX_ADS_ACCOUNTS)) {
    const id = name.replace("customers/", "");
    const rows = await search(f, access, id, "SELECT customer.id, customer.descriptive_name, customer.manager FROM customer").catch(() => []);
    const c = rows[0]?.customer;
    if (!c) continue;
    if (!c.manager) {
      out.push({ id, name: String(c.descriptiveName || formatCustomerId(id)), group: "", login: null });
      continue;
    }
    const clients = await search(
      f,
      access,
      id,
      "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 1",
      id,
    ).catch(() => []);
    for (const r of clients) {
      const cc = r.customerClient;
      if (!cc || cc.manager || cc.status !== "ENABLED") continue;
      const cid = String(cc.id);
      out.push({ id: cid, name: String(cc.descriptiveName || formatCustomerId(cid)), group: String(c.descriptiveName || formatCustomerId(id)), login: id });
    }
  }
  return out.filter((c, i) => out.findIndex((d) => d.id === c.id) === i);
}

export type GoogleAds = { currency: string; current: AdsTotals; previous: AdsTotals; campaigns: ({ name: string; status: string } & AdsTotals)[] };

const adsTotals = (m: Record<string, unknown> | undefined): AdsTotals => ({
  spend: n(m?.costMicros) / 1e6,
  clicks: n(m?.clicks),
  impressions: n(m?.impressions),
  conversions: n(m?.conversions),
  value: n(m?.conversionsValue),
});

// Rows summed, as Google returns one per day (or none) for a date range.
const sum = (rows: Row[]) =>
  rows.map((r) => adsTotals(r.metrics)).reduce((a, b) => ({ spend: a.spend + b.spend, clicks: a.clicks + b.clicks, impressions: a.impressions + b.impressions, conversions: a.conversions + b.conversions, value: a.value + b.value }), {
    spend: 0,
    clicks: 0,
    impressions: 0,
    conversions: 0,
    value: 0,
  });

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const METRICS = "metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value";

// The last 30 full days and the 30 before, matching Google Ads' own "Last 30 days".
export function adsRanges(now: Date) {
  const end = new Date(now.getTime() - DAY);
  const start = new Date(end.getTime() - 29 * DAY);
  const prevEnd = new Date(start.getTime() - DAY);
  const prevStart = new Date(prevEnd.getTime() - 29 * DAY);
  return { current: [ymd(start), ymd(end)], previous: [ymd(prevStart), ymd(prevEnd)] };
}

export function parseCampaigns(rows: Row[]) {
  const by = new Map<string, { name: string; status: string } & AdsTotals>();
  for (const r of rows) {
    const name = String(r.campaign?.name ?? "Campaign");
    const t = adsTotals(r.metrics);
    const had = by.get(name);
    by.set(
      name,
      had
        ? { ...had, spend: had.spend + t.spend, clicks: had.clicks + t.clicks, impressions: had.impressions + t.impressions, conversions: had.conversions + t.conversions, value: had.value + t.value }
        : { name, status: String(r.campaign?.status ?? ""), ...t },
    );
  }
  return [...by.values()].sort((a, b) => b.spend - a.spend).slice(0, 10);
}

export async function adsReport(access: string, customer: string, login: string | null, f: Fetch = fetch, now = new Date()): Promise<GoogleAds> {
  const { current, previous } = adsRanges(now);
  const between = ([a, b]: string[]) => `segments.date BETWEEN '${a}' AND '${b}'`;
  const [info, cur, prev, camps] = await Promise.all([
    search(f, access, customer, "SELECT customer.currency_code FROM customer", login),
    search(f, access, customer, `SELECT ${METRICS} FROM customer WHERE ${between(current)}`, login),
    search(f, access, customer, `SELECT ${METRICS} FROM customer WHERE ${between(previous)}`, login),
    search(f, access, customer, `SELECT campaign.name, campaign.status, ${METRICS} FROM campaign WHERE ${between(current)} AND metrics.cost_micros > 0`, login),
  ]);
  return { currency: String(info[0]?.customer?.currencyCode || "USD"), current: sum(cur), previous: sum(prev), campaigns: parseCampaigns(camps) };
}

// ---- Stored figures --------------------------------------------------------

export type Report = { analytics?: Analytics; analyticsError?: string; ads?: GoogleAds; adsError?: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function chooseSources(shop: string, choice: { gaProperty?: string | null; gaName?: string | null; adsCustomer?: string | null; adsLogin?: string | null; adsName?: string | null }) {
  await db.googleConnection.update({ where: { shop }, data: { ...choice, checkedAt: null } });
}

// Reads the chosen property and account again, one shop at a time.
export async function refreshGoogle(shop: string, f: Fetch = fetch, now = new Date()) {
  const claimed = await db.googleConnection.updateMany({
    where: { shop, OR: [{ runningAt: null }, { runningAt: { lt: new Date(now.getTime() - STUCK) } }] },
    data: { runningAt: now },
  });
  if (!claimed.count) return;
  try {
    const row = await db.googleConnection.findUnique({ where: { shop } });
    if (!row || (!row.gaProperty && !row.adsCustomer)) return;
    const report: Report = {};
    let access: string | null = null;
    try {
      access = await accessToken(unseal(row.refreshToken), f);
    } catch (err) {
      report.analyticsError = report.adsError = message(err);
    }
    if (access && row.gaProperty) await gaReport(access, row.gaProperty, f).then((a) => (report.analytics = a), (err) => (report.analyticsError = message(err)));
    if (access && row.adsCustomer) {
      if (!adsOn()) report.adsError = "Google Ads isn't switched on for this app yet.";
      else await adsReport(access, row.adsCustomer, row.adsLogin, f, now).then((a) => (report.ads = a), (err) => (report.adsError = message(err)));
    }
    await db.googleConnection.update({ where: { shop }, data: { report: report as Prisma.InputJsonObject, checkedAt: now } });
  } finally {
    await db.googleConnection.updateMany({ where: { shop }, data: { runningAt: null } });
  }
}

export async function startGoogleRefresh(shop: string, now = new Date()) {
  const row = await db.googleConnection.findUnique({ where: { shop } });
  if (!row || row.runningAt || (row.checkedAt && now.getTime() - row.checkedAt.getTime() < MIN_GAP)) return false;
  void refreshGoogle(shop).catch((err) => console.error("Couldn't read Google figures", shop, err));
  return true;
}

// Daily, for every shop that has chosen something to read.
export async function refreshAllGoogle(now = new Date()) {
  if (!googleOn()) return;
  const due = await db.googleConnection.findMany({
    where: { OR: [{ gaProperty: { not: null } }, { adsCustomer: { not: null } }], AND: [{ OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - DAY) } }] }] },
    select: { shop: true },
  });
  for (const { shop } of due) await refreshGoogle(shop, fetch, now).catch((err) => console.error("Couldn't read Google figures", shop, err));
}

export async function googleOverview(shop: string) {
  const row = await db.googleConnection.findUnique({ where: { shop } });
  if (!row) return null;
  return {
    email: row.email,
    analyticsAllowed: row.scopes.includes(GA_SCOPE),
    adsAllowed: row.scopes.includes(ADS_SCOPE),
    gaProperty: row.gaProperty,
    gaName: row.gaName,
    adsCustomer: row.adsCustomer,
    adsName: row.adsName,
    report: (row.report ?? null) as Report | null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    running: !!row.runningAt,
  };
}

// For the pickers: what this Google account can read. Errors come back as text for the page.
export async function googleChoices(shop: string, f: Fetch = fetch) {
  const row = await db.googleConnection.findUnique({ where: { shop } });
  if (!row) return null;
  let access: string;
  try {
    access = await accessToken(unseal(row.refreshToken), f);
  } catch (err) {
    return { properties: [], accounts: [], propertiesError: message(err), accountsError: message(err) };
  }
  const [properties, accounts] = await Promise.all([
    row.scopes.includes(GA_SCOPE) ? gaProperties(access, f).then((v) => ({ v }), (err) => ({ v: [] as Choice[], e: message(err) })) : { v: [] as Choice[] },
    row.scopes.includes(ADS_SCOPE) && adsOn() ? adsAccounts(access, f).then((v) => ({ v }), (err) => ({ v: [] as Choice[], e: message(err) })) : { v: [] as Choice[] },
  ]);
  return { properties: properties.v, accounts: accounts.v, propertiesError: "e" in properties ? properties.e : null, accountsError: "e" in accounts ? accounts.e : null };
}
