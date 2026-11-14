// Performance reports: the period a report covers and the shape of what it
// shows, shared by the server, the Reports page and the monthly email.

import type { AdNetwork, Metrics } from "../paidsocial/paid";
import type { Network, PostStats } from "../social/networks";

export type ReportPeriod = "7" | "30" | "this-month" | "last-month";

export const REPORT_PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
];

export const parseReportPeriod = (
  v: string | null | undefined,
): ReportPeriod =>
  v === "7" || v === "this-month" || v === "last-month" ? v : "30";

const DAY = 86400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (day: string) => new Date(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) =>
  iso(new Date(at(day).getTime() + n * DAY));
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const monthEnd = (day: string) => {
  const d = at(monthStart(day));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};

export type Range = {
  since: string; // YYYY-MM-DD, inclusive
  until: string; // YYYY-MM-DD, inclusive
  prevSince: string;
  prevUntil: string;
  label: string; // e.g. "1 Oct to 31 Oct 2026"
  prevLabel: string;
  days: number;
};

const short = (day: string) =>
  at(day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const long = (day: string) =>
  at(day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export const rangeLabel = (since: string, until: string) =>
  since === until
    ? long(until)
    : `${since.slice(0, 4) === until.slice(0, 4) ? short(since) : long(since)} to ${long(until)}`;

// The days a report covers (UTC) and the same length of time just before, to compare against.
// Calendar months compare with the whole month before.
export function reportRange(period: ReportPeriod, now = new Date()): Range {
  const today = iso(now);
  let since: string, until: string, prevSince: string, prevUntil: string;
  if (period === "this-month" || period === "last-month") {
    until = period === "this-month" ? today : addDays(monthStart(today), -1);
    since = monthStart(until);
    prevUntil = addDays(since, -1);
    prevSince = monthStart(prevUntil);
    // Part of a month compares with the same days of the month before.
    if (period === "this-month")
      prevUntil = [
        addDays(prevSince, Number(until.slice(8)) - 1),
        monthEnd(prevSince),
      ].sort()[0];
  } else {
    const n = Number(period);
    until = today;
    since = addDays(today, -(n - 1));
    prevUntil = addDays(since, -1);
    prevSince = addDays(since, -n);
  }
  const days =
    Math.round((at(until).getTime() - at(since).getTime()) / DAY) + 1;
  return {
    since,
    until,
    prevSince,
    prevUntil,
    label: rangeLabel(since, until),
    prevLabel: rangeLabel(prevSince, prevUntil),
    days,
  };
}

// Everything people did with a post: likes, comments, shares, saves and clicks.
export function engagement(s: PostStats) {
  const parts = [s.likes, s.comments, s.shares, s.saves, s.clicks].filter(
    (v): v is number => typeof v === "number",
  );
  return parts.length ? parts.reduce((a, b) => a + b, 0) : undefined;
}

const total = (list: (number | undefined)[]) => {
  const vals = list.filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined;
};

export type SocialSummary = {
  posts: number;
  reach?: number;
  engagements?: number;
  rate?: number;
  clicks?: number;
};

// Totals for a list of sent posts. Figures no post has stay undefined, so they show as "–" rather than 0.
export function socialSummary(stats: (PostStats | null)[]): SocialSummary {
  const known = stats.filter((s): s is PostStats => !!s);
  const reach = total(known.map((s) => s.reach));
  const engagements = total(known.map(engagement));
  return {
    posts: stats.length,
    reach,
    engagements,
    rate:
      engagements !== undefined && reach
        ? (engagements / reach) * 100
        : undefined,
    clicks: total(known.map((s) => s.clicks)),
  };
}

// Percentage change from before to now, or null when there's nothing to compare with.
export function change(
  now: number | null | undefined,
  before: number | null | undefined,
): number | null {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / before) * 100;
}

export const roas = (m: Pick<Metrics, "spend" | "value">) =>
  m.spend > 0 && m.value > 0 ? m.value / m.spend : null;

export type PaidAccountReport = {
  network: AdNetwork;
  name: string;
  currency: string;
  error: string | null;
  current: Metrics;
  previous: Metrics;
  campaigns: ({ name: string } & Metrics)[]; // The biggest spenders in the period
};

export type PostRow = {
  network: Network;
  account: string;
  text: string;
  day: string;
  url: string | null;
  reach?: number;
  engagements?: number;
};

export type Report = {
  shop: string;
  site: string | null;
  range: Range;
  createdAt: string;
  paid: PaidAccountReport[];
  social: {
    current: SocialSummary;
    previous: SocialSummary;
    byNetwork: ({ network: Network } & SocialSummary)[];
    top: PostRow[];
    followers: {
      network: Network;
      name: string;
      start: number | null;
      end: number | null;
    }[];
  } | null;
  google: {
    checkedAt: string | null;
    analytics: {
      currency: string;
      sessions: number;
      users: number;
      purchases: number;
      revenue: number;
      prevSessions: number;
      prevRevenue: number;
      prevPurchases: number;
      channels: { name: string; sessions: number; revenue: number }[];
    } | null;
    ads: {
      currency: string;
      spend: number;
      clicks: number;
      conversions: number;
      value: number;
      prevSpend: number;
      prevValue: number;
    } | null;
  } | null;
  search: {
    tracked: number;
    top3: number;
    top10: number;
    prevTop3: number | null;
    prevTop10: number | null;
    movers: { keyword: string; from: number | null; to: number | null }[];
  } | null;
  competitors: {
    rows: {
      name: string;
      organicTraffic: number | null;
      prevOrganicTraffic: number | null;
      paidCostCents: number | null;
      prevPaidCostCents: number | null;
      liveAds: number;
      newAds: number;
      changes: number;
    }[];
    events: { kind: string; count: number }[];
  } | null;
};
