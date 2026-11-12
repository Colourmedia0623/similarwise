// Paid social ads, for the server and the page: the shapes both share.

export type AdNetwork = "meta" | "tiktok";

export const AD_NETWORK_NAME: Record<AdNetwork, string> = { meta: "Facebook and Instagram", tiktok: "TikTok" };

// How a campaign's budget is set. "none" means it's set on each ad set
// (Meta) or ad group (TikTok) rather than on the campaign.
export type BudgetKind = "daily" | "lifetime" | "none";

export type Campaign = {
  id: string;
  name: string;
  on: boolean; // Switched on by the merchant
  delivery: string; // What the network says it's doing, in words, e.g. "Running", "In review"
  budgetKind: BudgetKind;
  budget: number | null; // In the account's currency
};

export type Metrics = { spend: number; impressions: number; clicks: number; purchases: number; value: number };

export const NO_METRICS: Metrics = { spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0 };

export function addMetrics(a: Metrics, b: Metrics): Metrics {
  return { spend: a.spend + b.spend, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, purchases: a.purchases + b.purchases, value: a.value + b.value };
}

export type Period = "7" | "30" | "month";
export const PERIODS: { key: Period; label: string }[] = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "month", label: "This month" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

// The days a period covers, as YYYY-MM-DD, up to and including today (UTC).
export function periodDates(period: Period, now = new Date()): { since: string; until: string } {
  const until = iso(now);
  if (period === "month") return { since: `${until.slice(0, 7)}-01`, until };
  const days = period === "7" ? 7 : 30;
  return { since: iso(new Date(now.getTime() - (days - 1) * 86400_000)), until };
}

export const parsePeriod = (v: string | null): Period => (v === "7" || v === "month" ? v : "30");

// Rounds an amount of money the way the networks take it: whole units for
// currencies without minor units, otherwise to the penny.
export const roundMoney = (v: number, currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(v) : Math.round(v * 100) / 100);

// Currencies Meta counts in whole units rather than hundredths.
export const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);

export function formatMoney(v: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}
