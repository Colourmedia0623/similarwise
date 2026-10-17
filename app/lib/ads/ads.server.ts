import db from "../../db.server";
import { hostOf } from "../tracker/url";
import { shopMarket } from "../traffic/refresh.server";
import { PLATFORM_LABEL } from "./platforms";
import { adsClient, type AdsClient, type AdsPage, type LibraryAd, type MetaPage, type Platform } from "./scrapecreators.server";

// The ads each competitor runs on Meta (Facebook and Instagram), TikTok and
// Google, from the platforms' public ad libraries. Refreshed weekly.

const WEEK = 7 * 24 * 3600_000;

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
// "www.rival-store.co.uk" → "rivalstore"
const stem = (domain: string) => norm(domain.replace(/^www\./, "").split(".")[0]);

// The Facebook page most likely to be the competitor's own: one whose name,
// page alias or Instagram handle matches their store name or domain.
export function pickMetaPage(name: string, domain: string, pages: MetaPage[]): MetaPage | null {
  const keys = new Set([norm(name), stem(domain)].filter(Boolean));
  const exact = pages.filter((p) => [p.name, p.alias, p.instagram].some((x) => x && keys.has(norm(x))));
  const pool = exact.length ? exact : pages.filter((p) => [...keys].some((k) => k.length >= 4 && norm(p.name).includes(k)));
  return [...pool].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))[0] ?? null;
}

const parseList = <T>(stored: string): T[] => {
  try {
    const v = JSON.parse(stored);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const snippet = (ad: LibraryAd) => {
  const t = ad.title ?? ad.text;
  return t ? `: "${t.length > 80 ? `${t.slice(0, 77)}…` : t}"` : "";
};

// Stores one platform's ads: new ones are added, ones still running are
// updated, and ones gone from a complete listing are marked as stopped.
// Returns the ads that are new.
async function saveAds(competitorId: string, platform: Platform, page: AdsPage, now: Date) {
  const existing = await db.competitorAd.findMany({ where: { competitorId, platform }, select: { id: true, adId: true, active: true } });
  const byAdId = new Map(existing.map((a) => [a.adId, a]));
  const added: LibraryAd[] = [];
  const seen = new Set<string>();
  for (const ad of page.ads) {
    if (seen.has(ad.adId)) continue;
    seen.add(ad.adId);
    const data = {
      title: ad.title,
      text: ad.text,
      imageUrl: ad.imageUrl,
      videoUrl: ad.videoUrl,
      linkUrl: ad.linkUrl,
      adUrl: ad.adUrl,
      cta: ad.cta,
      placements: JSON.stringify(ad.placements),
      format: ad.format,
      startedAt: ad.startedAt,
      lastShownAt: ad.lastShownAt,
      active: ad.active,
      lastSeenAt: now,
    };
    const had = byAdId.get(ad.adId);
    if (had) await db.competitorAd.update({ where: { id: had.id }, data });
    else {
      await db.competitorAd.create({ data: { competitorId, platform, adId: ad.adId, firstSeenAt: now, ...data } });
      if (ad.active) added.push(ad);
    }
  }
  if (page.complete) {
    const gone = existing.filter((a) => a.active && !seen.has(a.adId)).map((a) => a.id);
    if (gone.length) await db.competitorAd.updateMany({ where: { id: { in: gone } }, data: { active: false } });
  }
  return added;
}

export async function refreshAds(
  id: string,
  { client = adsClient(), force = false, now = new Date() }: { client?: AdsClient | null; force?: boolean; now?: Date } = {},
) {
  if (!client) return;
  const c = await db.competitor.findUnique({ where: { id } });
  if (!c) return;
  const market = await shopMarket(c.shop);
  const fresh = c.adsAt && now.getTime() - c.adsAt.getTime() < WEEK && c.adsMarket === market.code;
  if (fresh && !force) return;
  const domain = hostOf(c.url);
  const firstRun = c.adsAt == null;
  const errors: string[] = [];
  const added: Partial<Record<Platform, LibraryAd[]>> = {};
  const update: Record<string, unknown> = {};

  // Meta: find their page the first time, then read its running ads.
  try {
    let pageId = c.metaPageId;
    if (!pageId && c.metaCandidates === "[]") {
      let pages = await client.metaPages(c.name === domain ? domain.split(".")[0] : c.name);
      let pick = pickMetaPage(c.name, domain, pages);
      // A shop named for what it sells ("Wholesale Gift Boxes") often has a
      // page under its brand, which the domain usually carries.
      if (!pick && c.name !== domain && stem(domain).length >= 4) {
        const more = await client.metaPages(stem(domain));
        pages = [...pages, ...more.filter((p) => !pages.some((q) => q.id === p.id))];
        pick = pickMetaPage(c.name, domain, pages);
      }
      update.metaCandidates = JSON.stringify((pick ? [pick, ...pages.filter((p) => p.id !== pick.id)] : pages).slice(0, 8));
      if (pick) {
        pageId = pick.id;
        update.metaPageId = pick.id;
        update.metaPageName = pick.name;
      }
    }
    if (pageId) added.meta = await saveAds(id, "meta", await client.metaAds(pageId, market.code), now);
  } catch (err) {
    errors.push(`Meta: ${err instanceof Error ? err.message : String(err)}`);
  }

  // TikTok: search by advertiser name, keeping only that advertiser's ads.
  try {
    const result = await client.tiktokAds(c.tiktokAdvertiser ?? (update.metaPageName as string | undefined) ?? c.metaPageName ?? c.name);
    update.tiktokCandidates = JSON.stringify(result.matches);
    const who = c.tiktokAdvertiser ?? result.resolved;
    if (who) {
      if (!c.tiktokAdvertiser) update.tiktokAdvertiser = who;
      const ads = result.ads.filter((a) => a.advertiser && norm(a.advertiser) === norm(who));
      added.tiktok = await saveAds(id, "tiktok", { ads, complete: result.complete }, now);
    }
  } catch (err) {
    errors.push(`TikTok: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Google: by their website's domain.
  try {
    added.google = await saveAds(id, "google", await client.googleAds(domain, market.code), now);
  } catch (err) {
    errors.push(`Google: ${err instanceof Error ? err.message : String(err)}`);
  }

  const events = firstRun
    ? []
    : (Object.entries(added) as [Platform, LibraryAd[]][]).flatMap(([p, ads]) =>
        ads.length === 0
          ? []
          : [
              {
                competitorId: id,
                kind: "ad_launched",
                createdAt: now,
                message:
                  ads.length === 1
                    ? `Started a new ${PLATFORM_LABEL[p]} ad${snippet(ads[0])}`
                    : `Started ${ads.length} new ${PLATFORM_LABEL[p]} ads`,
              },
            ],
      );
  await db.$transaction([
    db.competitorEvent.createMany({ data: events }),
    db.competitor.update({
      where: { id },
      data: {
        ...update,
        // Partly failed runs still count as done; the error shows on the page.
        adsAt: errors.length === 3 ? c.adsAt : now,
        adsMarket: market.code,
        adsError: errors.length ? errors.join(" · ").slice(0, 500) : null,
      },
    }),
  ]);
}

// Sets which Facebook page is the competitor's (null: they have none), and
// reads its ads again.
export async function setMetaPage(shop: string, competitorId: string, pageId: string | null, client = adsClient()) {
  const c = await db.competitor.findFirst({ where: { id: competitorId, shop } });
  if (!c) return false;
  const page = parseList<MetaPage>(c.metaCandidates).find((p) => p.id === pageId);
  if (pageId && !page) return false;
  await db.$transaction([
    db.competitorAd.deleteMany({ where: { competitorId, platform: "meta" } }),
    db.competitor.update({
      where: { id: competitorId },
      data: { metaPageId: page?.id ?? null, metaPageName: page?.name ?? null, metaCandidates: c.metaCandidates === "[]" ? '[{"none":true}]' : c.metaCandidates },
    }),
  ]);
  await refreshAds(competitorId, { client, force: true });
  return true;
}

// The page a merchant points to by its Facebook link or name, e.g.
// "facebook.com/tinyboxcompany". Returns the page found, or null.
export function metaQuery(input: string) {
  const s = input.trim();
  const m = s.match(/facebook\.com\/(?:pg\/)?([^/?#]+)/i);
  const slug = m && !/^(pages|profile\.php|people)$/i.test(m[1]) ? decodeURIComponent(m[1]) : null;
  return { query: (slug ?? s).slice(0, 200), slug };
}

export async function findMetaPage(shop: string, competitorId: string, input: string, client = adsClient()) {
  const c = await db.competitor.findFirst({ where: { id: competitorId, shop } });
  if (!c || !client) return null;
  const { query, slug } = metaQuery(input);
  if (!query) return null;
  const pages = await client.metaPages(query);
  const page =
    (slug && pages.find((p) => p.alias && norm(p.alias) === norm(slug))) ||
    pages.find((p) => norm(p.name) === norm(query)) ||
    pickMetaPage(query, hostOf(c.url), pages) ||
    pages[0];
  if (!page) return null;
  const old = parseList<MetaPage>(c.metaCandidates).filter((p) => p.id && p.id !== page.id);
  await db.competitor.update({ where: { id: competitorId }, data: { metaCandidates: JSON.stringify([page, ...old].slice(0, 8)) } });
  await setMetaPage(shop, competitorId, page.id, client);
  return page;
}

export async function setTiktokAdvertiser(shop: string, competitorId: string, name: string, client = adsClient()) {
  const c = await db.competitor.findFirst({ where: { id: competitorId, shop } });
  if (!c) return false;
  const advertiser = name.trim().slice(0, 200) || null;
  await db.$transaction([
    db.competitorAd.deleteMany({ where: { competitorId, platform: "tiktok" } }),
    db.competitor.update({ where: { id: competitorId }, data: { tiktokAdvertiser: advertiser } }),
  ]);
  if (advertiser) await refreshAds(competitorId, { client, force: true });
  return true;
}

// The running ads across a shop's competitors, newest first, with each
// competitor's matched accounts.
export async function adsOverview(shop: string, filter: { competitorId?: string; platform?: Platform } = {}) {
  const competitors = await db.competitor.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      metaPageId: true,
      metaPageName: true,
      metaCandidates: true,
      tiktokAdvertiser: true,
      tiktokCandidates: true,
      adsAt: true,
      adsError: true,
    },
  });
  const counts = await db.competitorAd.groupBy({
    by: ["competitorId", "platform"],
    where: { competitor: { shop }, active: true },
    _count: true,
  });
  const ads = await db.competitorAd.findMany({
    where: {
      competitor: { shop },
      active: true,
      ...(filter.competitorId ? { competitorId: filter.competitorId } : {}),
      ...(filter.platform ? { platform: filter.platform } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { firstSeenAt: "desc" }],
    take: 60,
    include: { competitor: { select: { name: true } } },
  });
  const count = (id: string, p: Platform) => counts.find((x) => x.competitorId === id && x.platform === p)?._count ?? 0;
  return {
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      checked: c.adsAt?.toISOString() ?? null,
      error: c.adsError,
      meta: { id: c.metaPageId, name: c.metaPageName, candidates: parseList<MetaPage>(c.metaCandidates).filter((p) => p.id) },
      tiktok: { name: c.tiktokAdvertiser, candidates: parseList<string>(c.tiktokCandidates) },
      counts: { meta: count(c.id, "meta"), tiktok: count(c.id, "tiktok"), google: count(c.id, "google") },
    })),
    ads: ads.map((a) => ({
      id: a.id,
      competitor: a.competitor.name,
      platform: a.platform as Platform,
      title: a.title,
      text: a.text,
      imageUrl: a.imageUrl,
      videoUrl: a.videoUrl,
      linkUrl: a.linkUrl,
      adUrl: a.adUrl,
      cta: a.cta,
      placements: parseList<string>(a.placements),
      format: a.format,
      startedAt: a.startedAt?.toISOString() ?? null,
    })),
  };
}
