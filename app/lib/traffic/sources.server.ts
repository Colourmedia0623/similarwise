import db from "../../db.server";
import type { Shares, Source } from "./sources";

// Where websites' visits come from, and from which countries: Similarweb's
// public estimates, read through an Apify scraper, one run for all the
// domains that are due. Off unless APIFY_TOKEN is set. Sites too small for
// Similarweb come back with no figures.

const WEEK = 7 * 24 * 3600_000;
const ACTOR = "bovi~similarweb-scraper";

export type SiteFigures = { domain: string; visits: number | null; sources: Shares; countries: { code: string; share: number }[]; error: string | null };
export type SourcesClient = { sites(domains: string[]): Promise<SiteFigures[]> };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? (v > 1 ? v / 100 : v) : 0);
const bare = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

// Similarweb's ten channels, folded into the eight the page shows.
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
};
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function parseSites(json: unknown): SiteFigures[] {
  return (Array.isArray(json) ? json : []).flatMap((r) => {
    const a = obj(r);
    const domain = typeof a.domain === "string" ? bare(a.domain) : null;
    if (!domain) return [];
    const raw = obj(a.traffic_sources ?? a.trafficSources);
    const sources: Shares = {};
    for (const [from, to] of Object.entries(FOLD)) {
      const v = share(raw[from] ?? raw[camel(from)]);
      if (v > 0) sources[to] = (sources[to] ?? 0) + v;
    }
    const countries = (Array.isArray(a.top_countries ?? a.topCountries) ? ((a.top_countries ?? a.topCountries) as unknown[]) : []).flatMap((c) => {
      const o = obj(c);
      const code = o.cc ?? o.countryCode ?? o.country_code;
      const s = share(o.share ?? o.visitsShare ?? o.visits_share);
      return typeof code === "string" && s > 0 ? [{ code: code.toUpperCase().slice(0, 2), share: s }] : [];
    });
    const visits = a.monthly_visits_avg ?? a.monthlyVisitsAvg ?? a.visits;
    const empty = Object.keys(sources).length === 0;
    return [
      {
        domain,
        visits: typeof visits === "number" && visits > 0 ? Math.round(visits) : null,
        sources,
        countries: countries.slice(0, 5),
        error: typeof a.error === "string" && a.error ? a.error.slice(0, 200) : empty ? "Too few visitors for Similarweb to estimate" : null,
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
        body: JSON.stringify({ domains }),
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
        error: r.error,
        fetchedAt: r.fetchedAt.getTime() > 0 ? r.fetchedAt : null,
      },
    ]),
  );
}
