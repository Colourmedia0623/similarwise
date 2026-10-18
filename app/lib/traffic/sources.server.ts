import db from "../../db.server";
import type { Shares, Source } from "./sources";

// Where websites' visits come from, and from which countries: Similarweb's
// public estimates, read through an Apify scraper, one run for all the
// domains that are due. Off unless APIFY_TOKEN is set. Sites too small for
// Similarweb come back with no figures.

const WEEK = 7 * 24 * 3600_000;
const ACTOR = "locaihost~website-traffic";

// How visitors behave once they arrive, and how the site ranks, as Similarweb
// estimates them. Any field can be missing.
export type Engagement = {
  bounceRate: number | null; // 0-1
  pagesPerVisit: number | null;
  durationSeconds: number | null;
  visitsChange: number | null; // Month on month, e.g. 0.12 for up 12%
  globalRank: number | null;
  countryRank: number | null;
  rankCountry: string | null;
  category: string | null;
  categoryRank?: number | null; // Rank among sites in the same category
  history: { month: string; visits: number }[]; // Oldest first, "2026-09"
  aiShare?: number | null; // 0-1, the share of visits sent by AI assistants
  aiChatbots?: { name: string; share: number }[]; // Each assistant's share of those visits, biggest first
};

export type SiteFigures = {
  domain: string;
  visits: number | null;
  sources: Shares;
  countries: { code: string; share: number }[];
  engagement?: Engagement;
  error: string | null;
};
export type SourcesClient = { sites(domains: string[]): Promise<SiteFigures[]> };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? (v > 1 ? v / 100 : v) : 0);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const bare = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

// Similarweb's channels, folded into the eight the page shows. Scrapers name
// them differently; both spellings below are read.
const FOLD: Record<string, Source> = {
  direct: "direct",
  search_organic: "search",
  search_paid: "paidSearch",
  social_organic: "social",
  social_paid: "social",
  referrals: "referrals",
  mail: "email",
  display_ads: "display",
  gen_ai: "other",
  affiliate: "other",
  organicSearch: "search",
  paidSearch: "paidSearch",
  socialOrganic: "social",
  socialPaid: "social",
  email: "email",
  displayAds: "display",
  affiliates: "other",
  aiChatbots: "other",
  organic: "search",
  paid: "paidSearch",
  ads: "display",
  directVisitsShare: "direct",
  referralVisitsShare: "referrals",
  socialNetworksVisitsShare: "social",
  mailVisitsShare: "email",
  adsVisitsShare: "display",
};
// "45.2%", 45.2 and 0.452 all mean 45.2%.
const ratio = (v: unknown) => {
  const n = typeof v === "string" ? num(v.replace("%", "")) : num(v);
  return n == null || n < 0 ? null : n > 1 ? n / 100 : n;
};
// Seconds, from 325 or "00:05:25".
const seconds = (v: unknown) => {
  if (typeof v === "string" && /^\d{1,2}(:\d{2}){1,2}$/.test(v.trim())) return v.trim().split(":").reduce((t, p) => t * 60 + Number(p), 0);
  const n = num(v);
  return n == null || n < 0 ? null : Math.round(n);
};
const rank = (v: unknown) => {
  const n = num(typeof v === "string" ? v.replace(/[#,]/g, "") : v);
  return n != null && n >= 1 ? Math.round(n) : null;
};
// "2026-09", from "2026-09", "2026-09-01" or "September 2026".
const month = (v: unknown) => {
  if (typeof v !== "string") return null;
  const iso = v.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const d = new Date(`1 ${v}`);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const BOT_NAMES: Record<string, string> = { chatgpt: "ChatGPT", openai: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude", copilot: "Copilot", deepseek: "DeepSeek", grok: "Grok", meta: "Meta AI" };
const botName = (k: string) => {
  const flat = k.toLowerCase().replace(/[^a-z]/g, "");
  const hit = Object.keys(BOT_NAMES).find((b) => flat.includes(b));
  return hit ? BOT_NAMES[hit] : k.slice(0, 40);
};

// Each AI assistant's share of the AI visits, from { chatgpt: 70 } or [{ name, share }].
export function parseChatbots(v: unknown): { name: string; share: number }[] {
  const pairs: [string, unknown][] = Array.isArray(v)
    ? v.map(obj).flatMap((o) => {
        const name = o.name ?? o.chatbot ?? o.source ?? o.domain;
        return typeof name === "string" ? [[name, o.share ?? o.percentage ?? o.visitsShare] as [string, unknown]] : [];
      })
    : Object.entries(obj(v));
  const merged = new Map<string, number>();
  for (const [k, raw] of pairs) {
    const r = ratio(raw);
    if (r == null || r <= 0) continue;
    const name = botName(k);
    merged.set(name, (merged.get(name) ?? 0) + r);
  }
  return [...merged].map(([name, share]) => ({ name, share })).sort((a, b) => b.share - a.share).slice(0, 5);
}

// AI visits over all visits. The scraper's own share field doesn't say
// whether 0.4 means 0.4% or 40%, so it's worked out from the visit counts.
function aiShare(a: Json) {
  const ai = num(a.aiChatbotVisits);
  const all = num(a.monthly_visits_avg ?? a.monthlyVisitsAvg ?? a.monthlyVisits ?? a.totalVisits ?? a.visits);
  return ai != null && all != null && all > 0 && ai >= 0 && ai <= all ? ai / all : null;
}

export function parseEngagement(a: Json): Engagement {
  const history = (Array.isArray(a.monthlyVisitsHistory) ? a.monthlyVisitsHistory : []).flatMap((h) => {
    const o = obj(h);
    const m = month(o.month ?? o.date);
    const v = num(o.visits);
    return m && v != null && v >= 0 ? [{ month: m, visits: Math.round(v) }] : [];
  });
  const change = num(typeof a.monthlyVisitsChange === "string" ? a.monthlyVisitsChange.replace("%", "") : a.monthlyVisitsChange);
  return {
    bounceRate: ratio(a.bounceRate),
    pagesPerVisit: num(a.pagesPerVisit),
    durationSeconds: seconds(a.avgVisitDurationSeconds ?? a.avgVisitDuration),
    // A change of 12 means 12%; one already as a fraction stays as it is.
    visitsChange: change == null ? null : Math.abs(change) > 1.5 || typeof a.monthlyVisitsChange === "string" ? change / 100 : change,
    globalRank: rank(a.globalRank),
    countryRank: rank(a.countryRank),
    rankCountry: typeof a.countryRankCountry === "string" ? a.countryRankCountry.slice(0, 40) : null,
    category: typeof a.category === "string" && a.category ? a.category.slice(0, 80) : null,
    categoryRank: rank(a.categoryRank),
    aiShare: aiShare(a),
    aiChatbots: parseChatbots(a.aiChatbotShares),
    history: history.sort((x, y) => x.month.localeCompare(y.month)).slice(-12),
  };
}

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function parseSites(json: unknown): SiteFigures[] {
  return (Array.isArray(json) ? json : []).flatMap((r) => {
    const a = obj(r);
    const name = a.domain ?? a.name;
    const domain = typeof name === "string" ? bare(name) : null;
    if (!domain) return [];
    const listed = a.traffic_sources ?? a.trafficSources;
    // Either { channel: share } or [{ source, percentage }], where the free page
    // hides most channels (percentage null).
    const raw = Array.isArray(listed)
      ? Object.fromEntries(listed.map(obj).flatMap((o) => (typeof o.source === "string" ? [[o.source, o.percentage ?? o.share]] : [])))
      : obj(listed);
    const sources: Shares = {};
    // Each field counts once, though snake_case names also match camelCase.
    const read = new Set<string>();
    for (const [from, to] of Object.entries(FOLD)) {
      const key = from in raw ? from : camel(from);
      if (read.has(key)) continue;
      read.add(key);
      const v = share(raw[key]);
      if (v > 0) sources[to] = (sources[to] ?? 0) + v;
    }
    // One search share, with organic and paid given as parts of it.
    const search = share(raw.searchVisitsShare);
    if (search > 0) {
      const organic = typeof a.organicTraffic === "number" ? a.organicTraffic : null;
      const paid = typeof a.paidTraffic === "number" ? a.paidTraffic : null;
      const split = organic != null && paid != null && organic + paid > 0 ? paid / (organic + paid) : 0;
      sources.search = (sources.search ?? 0) + search * (1 - split);
      if (split > 0) sources.paidSearch = (sources.paidSearch ?? 0) + search * split;
    }
    const countries = (Array.isArray(a.top_countries ?? a.topCountries) ? ((a.top_countries ?? a.topCountries) as unknown[]) : []).flatMap((c) => {
      const o = obj(c);
      const code = o.cc ?? o.countryCode ?? o.country_code ?? o.countryAlpha2Code ?? o.country;
      const s = share(o.share ?? o.visitsShare ?? o.visits_share);
      return typeof code === "string" && s > 0 ? [{ code: code.toUpperCase().slice(0, 2), share: s }] : [];
    });
    const visits = num(a.monthly_visits_avg ?? a.monthlyVisitsAvg ?? a.monthlyVisits ?? a.totalVisits ?? a.visits);
    const empty = Object.keys(sources).length === 0;
    return [
      {
        domain,
        visits: visits != null && visits > 0 ? Math.round(visits) : null,
        sources,
        countries: countries.slice(0, 5),
        engagement: parseEngagement(a),
        error: typeof (a.error ?? a.trafficError) === "string" && (a.error ?? a.trafficError) ? String(a.error ?? a.trafficError).slice(0, 200) : empty ? "Too few visitors for Similarweb to estimate" : null,
      },
    ];
  });
}

export function sourcesClient(): SourcesClient | null {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  return {
    async sites(domains) {
      const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=280`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domains, includeWebsiteChecks: false }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`Apify answered ${res.status}`);
      return parseSites(await res.json());
    },
  };
}

// Fetches the domains not read in the last week (all of them with force).
export async function refreshSources(domains: string[], { client = sourcesClient(), force = false, now = new Date() }: { client?: SourcesClient | null; force?: boolean; now?: Date } = {}) {
  if (!client) return;
  const wanted = [...new Set(domains.map(bare).filter(Boolean))];
  const have = await db.siteSources.findMany({ where: { domain: { in: wanted } } });
  const due = wanted.filter((d) => {
    const h = have.find((x) => x.domain === d);
    return force || !h || now.getTime() - h.fetchedAt.getTime() >= WEEK;
  });
  if (!due.length) return;
  let found: SiteFigures[];
  try {
    found = await client.sites(due);
  } catch (err) {
    // Kept as it was, so the next run tries again; only new domains get the error.
    const message = `Couldn't get traffic sources: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
    for (const d of due.filter((d) => !have.some((h) => h.domain === d)))
      await db.siteSources.create({ data: { domain: d, fetchedAt: new Date(0), error: message } });
    return;
  }
  for (const d of due) {
    const f = found.find((x) => x.domain === d);
    const data = {
      visits: f?.visits ?? null,
      sources: JSON.stringify(f?.sources ?? {}),
      countries: JSON.stringify(f?.countries ?? []),
      engagement: f?.engagement ? JSON.stringify(f.engagement) : null,
      fetchedAt: now,
      error: f ? f.error : "Similarweb has no figures for this site",
    };
    await db.siteSources.upsert({ where: { domain: d }, create: { domain: d, ...data }, update: data });
  }
}

export async function siteSources(domains: string[]) {
  const rows = await db.siteSources.findMany({ where: { domain: { in: domains.map(bare) } } });
  return new Map(
    rows.map((r) => [
      r.domain,
      {
        visits: r.visits,
        sources: JSON.parse(r.sources) as Shares,
        countries: JSON.parse(r.countries) as { code: string; share: number }[],
        engagement: r.engagement ? (JSON.parse(r.engagement) as Engagement) : null,
        error: r.error,
        fetchedAt: r.fetchedAt.getTime() > 0 ? r.fetchedAt : null,
      },
    ]),
  );
}
