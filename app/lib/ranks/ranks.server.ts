import db from "../../db.server";
import { poster, taskResult } from "../traffic/dataforseo.server";
import { shopDomain } from "../traffic/gap.server";
import { shopMarket } from "../traffic/refresh.server";
import { marketFor, type Market } from "../traffic/markets";
import { hostOf } from "../tracker/url";

// Rank tracker: the Google searches a shop chooses, looked up daily through
// DataForSEO's live results, to record where the shop and each competitor
// rank in the top 30.

const DAY = 86400_000;
const MIN_GAP = 6 * 3600_000; // Between checks the merchant starts
const STUCK = 3600_000;
const KEEP = 180 * DAY;
export const MAX_KEYWORDS = 50;
// How far down Google's results to look. DataForSEO bills each page of 10,
// so three pages keeps a full list of searches near $9 a month per shop.
export const DEPTH = 30;
const AT_ONCE = 5;

export type Result = { domain: string; position: number; url: string };
export type SerpClient = (keyword: string, market: Market) => Promise<Result[]>;

// The organic results on one search, best first, one per domain.
export function parseSerp(json: unknown): Result[] {
  const items = (taskResult(json)[0]?.items ?? []) as { type?: string; rank_group?: number; domain?: string; url?: string }[];
  const seen = new Set<string>();
  const out: Result[] = [];
  for (const it of items) {
    if (it.type !== "organic" || typeof it.rank_group !== "number" || !it.domain) continue;
    const domain = it.domain.toLowerCase().replace(/^www\./, "");
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ domain, position: it.rank_group, url: (it.url ?? "").slice(0, 500) });
  }
  return out;
}

export function serpClient(): SerpClient | null {
  const post = poster(90_000);
  if (!post) return null;
  return async (keyword, market) =>
    parseSerp(
      await post("/serp/google/organic/live/regular", {
        keyword: keyword.slice(0, 200),
        location_code: market.location,
        language_code: market.language,
        depth: DEPTH,
      }),
    );
}

const matches = (domain: string, site: string) => domain === site || domain.endsWith(`.${site}`);
const rankOf = (results: Result[], site: string | null) => (site ? (results.find((r) => matches(r.domain, site)) ?? null) : null);

const cleanKeyword = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);

// Adds searches, one per line or comma. Returns how many were new.
export async function addKeywords(shop: string, text: string) {
  const wanted = [...new Set(text.split(/[\n,]/).map(cleanKeyword).filter((k) => k.length >= 2))];
  if (!wanted.length) return { error: "Type the searches you want to track, one per line." };
  const existing = new Set((await db.trackedKeyword.findMany({ where: { shop }, select: { keyword: true } })).map((k) => k.keyword));
  const fresh = wanted.filter((k) => !existing.has(k));
  const room = MAX_KEYWORDS - existing.size;
  if (fresh.length && room <= 0) return { error: `You can track up to ${MAX_KEYWORDS} searches. Remove some first.` };
  const add = fresh.slice(0, room);
  if (add.length) await db.trackedKeyword.createMany({ data: add.map((keyword) => ({ shop, keyword })) });
  return { added: add.length, skipped: fresh.length - add.length };
}

// Fills the list from the keyword gap's biggest searches.
export async function addFromGap(shop: string) {
  const gap = await db.keywordGap.findMany({
    where: { competitor: { shop } },
    orderBy: { searchVolume: "desc" },
    take: 60,
    select: { keyword: true },
    distinct: ["keyword"],
  });
  if (!gap.length) return { error: "The keyword gap has no searches yet. Refresh it first." };
  return addKeywords(shop, gap.map((g) => g.keyword).join("\n"));
}

export async function removeKeyword(shop: string, id: string) {
  const { count } = await db.trackedKeyword.deleteMany({ where: { id, shop } });
  if (count) await db.keywordRank.deleteMany({ where: { keywordId: id, shop } });
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// Looks up every tracked search and keeps where each site ranked. Claims the
// shop first so two checks can't run at once.
export async function runRankCheck(shop: string, { client = serpClient(), now = new Date() }: { client?: SerpClient | null; now?: Date } = {}) {
  if (!client) return { error: "The rank tracker isn't switched on for this app yet." };
  await db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });
  const { count } = await db.shopSettings.updateMany({
    where: { shop, OR: [{ ranksRunningAt: null }, { ranksRunningAt: { lt: new Date(now.getTime() - STUCK) } }] },
    data: { ranksRunningAt: now },
  });
  if (!count) return { error: "A check is already running." };
  try {
    const [keywords, domain, market, competitors] = await Promise.all([
      db.trackedKeyword.findMany({ where: { shop } }),
      shopDomain(shop),
      shopMarket(shop),
      db.competitor.findMany({ where: { shop }, select: { id: true, url: true } }),
    ]);
    const sites = competitors.map((c) => ({ id: c.id, domain: hostOf(c.url) }));
    let failed = 0;
    let lastError = "";
    await inBatches(keywords, AT_ONCE, async (k) => {
      try {
        const results = await client(k.keyword, market);
        const you = rankOf(results, domain);
        const theirs = Object.fromEntries(sites.flatMap((s) => {
          const r = rankOf(results, s.domain);
          return r ? [[s.id, r.position]] : [];
        }));
        await db.keywordRank.create({
          data: { shop, keywordId: k.id, checkedAt: now, position: you?.position ?? null, url: you?.url || null, competitors: JSON.stringify(theirs) },
        });
      } catch (err) {
        failed++;
        lastError = err instanceof Error ? err.message : String(err);
        console.error("Couldn't check a ranking", shop, k.keyword, err);
        await db.keywordRank.create({ data: { shop, keywordId: k.id, checkedAt: now, error: lastError.slice(0, 300) } });
      }
    });
    const ranksError = keywords.length && failed === keywords.length ? `Couldn't check Google: ${lastError}`.slice(0, 300) : null;
    await db.keywordRank.deleteMany({ where: { shop, checkedAt: { lt: new Date(now.getTime() - KEEP) } } });
    await db.shopSettings.update({ where: { shop }, data: { ranksCheckedAt: now, ranksRunningAt: null, ranksError } });
    return ranksError ? { error: ranksError } : { ok: true as const };
  } catch (err) {
    await db.shopSettings.update({ where: { shop }, data: { ranksRunningAt: null } });
    throw err;
  }
}

// A check the merchant starts, run in the background.
export async function startRankCheck(shop: string, { client = serpClient(), now = new Date() }: { client?: SerpClient | null; now?: Date } = {}) {
  if (!client) return { error: "The rank tracker isn't switched on for this app yet." };
  if (!(await shopDomain(shop))) return { error: "Add your store's website on the Keyword gap page first." };
  if (!(await db.trackedKeyword.count({ where: { shop } }))) return { error: "Add some searches first." };
  const s = await db.shopSettings.findUnique({ where: { shop } });
  if (s?.ranksRunningAt && now.getTime() - s.ranksRunningAt.getTime() < STUCK) return { error: "A check is already running." };
  // A check that failed outright can be tried again straight away.
  if (s?.ranksCheckedAt && !s.ranksError && now.getTime() - s.ranksCheckedAt.getTime() < MIN_GAP) return { error: "Rankings were checked in the last few hours. Try again later." };
  void runRankCheck(shop, { client, now }).catch((err) => console.error("Rank check failed", shop, err));
  return { started: true as const };
}

// The daily run, from the hourly schedule.
export async function refreshAllRanks({ client = serpClient(), now = new Date() }: { client?: SerpClient | null; now?: Date } = {}) {
  if (!client) return;
  const shops = await db.trackedKeyword.findMany({ select: { shop: true }, distinct: ["shop"] });
  for (const { shop } of shops) {
    const s = await db.shopSettings.findUnique({ where: { shop } });
    if (s?.ranksCheckedAt && now.getTime() - s.ranksCheckedAt.getTime() < DAY - 3600_000) continue;
    if (!(await shopDomain(shop))) continue;
    await runRankCheck(shop, { client, now }).catch((err) => console.error("Rank check failed", shop, err));
  }
}

const parse = (json: string): Record<string, number> => {
  try {
    return JSON.parse(json) as Record<string, number>;
  } catch {
    return {};
  }
};

// Everything the rank tracker page shows.
export async function rankOverview(shop: string, now = new Date()) {
  const [settings, domain, keywords, competitors] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopDomain(shop),
    db.trackedKeyword.findMany({ where: { shop }, orderBy: { keyword: "asc" } }),
    db.competitor.findMany({ where: { shop }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const rows = await db.keywordRank.findMany({
    where: { shop, checkedAt: { gte: new Date(now.getTime() - 90 * DAY) } },
    orderBy: { checkedAt: "asc" },
  });
  // Checks where every lookup failed are left out, so they don't read as no rankings.
  const checks = [...new Set(rows.filter((r) => !r.error).map((r) => r.checkedAt.getTime()))].sort((a, b) => a - b);
  const lastRun = rows.length ? Math.max(...rows.map((r) => r.checkedAt.getTime())) : undefined;
  const latest = checks[checks.length - 1];
  // The check nearest a week before the latest, for the change column.
  const weekAgo = latest == null ? undefined : [...checks].reverse().find((t) => t <= latest - 6 * DAY) ?? (checks.length > 1 ? checks[0] : undefined);
  const at = (t: number | undefined, id: string) => (t == null ? undefined : rows.find((r) => r.checkedAt.getTime() === t && r.keywordId === id));
  const ids = new Set(keywords.map((k) => k.id));
  const live = rows.filter((r) => ids.has(r.keywordId) && !r.error);

  return {
    depth: DEPTH,
    domain,
    market: marketFor(settings?.market).name,
    running: !!settings?.ranksRunningAt && now.getTime() - settings.ranksRunningAt.getTime() < STUCK,
    checkedAt: settings?.ranksCheckedAt?.toISOString() ?? null,
    error: settings?.ranksError ?? null,
    competitors,
    keywords: keywords.map((k) => {
      const failed = lastRun !== latest ? at(lastRun, k.id) : undefined;
      const cur = at(latest, k.id);
      const before = at(weekAgo, k.id);
      const theirs = parse(cur?.competitors ?? "{}");
      return {
        id: k.id,
        keyword: k.keyword,
        checked: !!cur || !!failed,
        error: cur?.error ?? (cur ? null : (failed?.error ?? null)),
        position: cur?.position ?? null,
        url: cur?.url ?? null,
        // Positive means the shop moved up. A new ranking counts from just below the depth.
        change: cur && before && !cur.error && !before.error && (cur.position != null || before.position != null) ? (before.position ?? DEPTH + 1) - (cur.position ?? DEPTH + 1) : null,
        competitors: competitors.map((c) => theirs[c.id] ?? null),
      };
    }),
    // How many tracked searches the shop was in the top 3, 10 and 30 for, on each check.
    trend: checks.map((t) => {
      const day = live.filter((r) => r.checkedAt.getTime() === t);
      return {
        at: new Date(t).toISOString(),
        top3: day.filter((r) => r.position != null && r.position <= 3).length,
        top10: day.filter((r) => r.position != null && r.position <= 10).length,
        ranked: day.filter((r) => r.position != null).length,
      };
    }),
  };
}
