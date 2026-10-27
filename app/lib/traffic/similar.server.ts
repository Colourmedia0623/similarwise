import db from "../../db.server";
import { hostOf } from "../tracker/url";
import { maxCompetitors } from "../tracker/check.server";
import { isPlatform } from "../links/links.server";
import { poster, taskResult } from "./dataforseo.server";
import { shopDomain } from "./gap.server";
import { shopMarket } from "./refresh.server";
import type { Market } from "./markets";

// Similar sites: websites ranking for many of the same Google searches as
// the shop and its competitors, from DataForSEO Labs, so the merchant can
// find competitors they haven't added. Refreshed weekly.

const WEEK = 7 * 24 * 3600_000;
const PER_SITE = 30;
const KEEP = 50;

export type Competing = { domain: string; sharedKeywords: number; traffic: number | null };
export type SimilarClient = { competitors(domain: string, market: Market): Promise<Competing[]> };

// Marketplaces and reference sites rank for everything; they aren't stores
// to track.
const BIG = /(^|\.)(amazon|ebay|etsy|wikipedia|alibaba|aliexpress|walmart|temu|wish|argos|target|youtube|facebook|reddit|quora|pinterest|instagram|tiktok|google)\.[a-z.]+$/;

export function parseCompetitors(json: unknown): Competing[] {
  const items = (taskResult(json)[0]?.items ?? []) as {
    domain?: string;
    intersections?: number;
    full_domain_metrics?: { organic?: { etv?: number } };
  }[];
  return items.flatMap((it) => {
    const domain = typeof it.domain === "string" ? it.domain.toLowerCase().replace(/^www\./, "") : "";
    if (!domain || typeof it.intersections !== "number") return [];
    const etv = it.full_domain_metrics?.organic?.etv;
    return [{ domain: domain.slice(0, 200), sharedKeywords: Math.round(it.intersections), traffic: typeof etv === "number" ? Math.round(etv) : null }];
  });
}

export function similarClient(): SimilarClient | null {
  const post = poster();
  if (!post) return null;
  return {
    async competitors(domain, market) {
      return parseCompetitors(
        await post("/dataforseo_labs/google/competitors_domain/live", {
          target: domain,
          location_code: market.location,
          language_code: market.language,
          item_types: ["organic"],
          exclude_top_domains: true,
          limit: PER_SITE,
          order_by: ["intersections,desc"],
        }),
      );
    },
  };
}

export async function refreshSimilar(
  shop: string,
  { client = similarClient(), force = false, now = new Date() }: { client?: SimilarClient | null; force?: boolean; now?: Date } = {},
) {
  if (!client) return;
  const [s, domain, market, competitors] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopDomain(shop),
    shopMarket(shop),
    db.competitor.findMany({ where: { shop }, select: { url: true } }),
  ]);
  const sources = [...new Set([...(domain ? [domain] : []), ...competitors.map((c) => hostOf(c.url))])];
  if (!sources.length) return;
  const key = `${market.code}:${[...sources].sort().join(",")}`;
  const fresh = s?.similarAt && now.getTime() - s.similarAt.getTime() < WEEK && s.similarKey === key;
  if (fresh && !force) return;

  const found = new Map<string, Competing & { similarTo: string[] }>();
  const errors: string[] = [];
  for (const source of sources) {
    try {
      for (const c of await client.competitors(source, market)) {
        const row = found.get(c.domain) ?? { ...c, sharedKeywords: 0, similarTo: [] };
        row.sharedKeywords += c.sharedKeywords;
        row.traffic = c.traffic ?? row.traffic;
        row.similarTo.push(source === domain ? "you" : source);
        found.set(c.domain, row);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  // Every lookup failed: keep last week's list and say why.
  if (errors.length === sources.length) {
    await db.shopSettings.upsert({
      where: { shop },
      create: { shop, similarError: `Couldn't find similar sites: ${errors[0]}`.slice(0, 300) },
      update: { similarError: `Couldn't find similar sites: ${errors[0]}`.slice(0, 300) },
    });
    return;
  }
  const sites = [...found.values()]
    .filter((r) => !sources.includes(r.domain) && !isPlatform(r.domain) && !BIG.test(r.domain))
    .sort((a, b) => b.similarTo.length - a.similarTo.length || b.sharedKeywords - a.sharedKeywords)
    .slice(0, KEEP);
  await db.$transaction([
    db.similarSite.deleteMany({ where: { shop } }),
    db.similarSite.createMany({
      data: sites.map((r) => ({ shop, domain: r.domain, sharedKeywords: r.sharedKeywords, traffic: r.traffic, similarTo: JSON.stringify(r.similarTo) })),
    }),
    db.shopSettings.upsert({
      where: { shop },
      create: { shop, similarAt: now, similarKey: key, similarError: null },
      update: { similarAt: now, similarKey: key, similarError: null },
    }),
  ]);
}

export async function refreshAllSimilar() {
  for (const s of await db.shopSettings.findMany({ select: { shop: true } })) {
    await refreshSimilar(s.shop).catch((err) => console.error(`Couldn't find similar sites for ${s.shop}`, err));
  }
}

// The similar sites not already tracked, sites similar to several of the
// shop's first, with the names of the sites each one competes with.
export async function similarSites(shop: string) {
  const [s, domain, competitors, rows] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopDomain(shop),
    db.competitor.findMany({ where: { shop }, select: { url: true, name: true } }),
    db.similarSite.findMany({ where: { shop }, orderBy: { sharedKeywords: "desc" } }),
  ]);
  const tracked = new Set([domain, ...competitors.map((c) => hostOf(c.url))]);
  const names = new Map(competitors.map((c) => [hostOf(c.url), c.name]));
  const sites = rows
    .filter((r) => !tracked.has(r.domain))
    .map((r) => {
      let similarTo: string[] = [];
      try {
        similarTo = (JSON.parse(r.similarTo) as string[]).map((d) => (d === "you" ? "You" : (names.get(d) ?? d)));
      } catch {
        // Shown without the sites it's similar to.
      }
      return { domain: r.domain, sharedKeywords: r.sharedKeywords, traffic: r.traffic, similarTo };
    })
    .sort((a, b) => b.similarTo.length - a.similarTo.length || b.sharedKeywords - a.sharedKeywords);
  return {
    domain,
    tracking: competitors.length,
    full: competitors.length >= maxCompetitors(shop),
    at: s?.similarAt?.toISOString() ?? null,
    error: s?.similarError ?? null,
    sites,
  };
}
