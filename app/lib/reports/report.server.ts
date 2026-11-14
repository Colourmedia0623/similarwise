import db from "../../db.server";
import { paidReport } from "../paidsocial/paid.server";
import type { Fetch } from "../paidsocial/networks.server";
import { readStats } from "../social/social.server";
import type { Network, PostStats } from "../social/networks";
import type { Report as GoogleReport } from "../google/google.server";
import { shopDomain } from "../traffic/gap.server";
import {
  engagement,
  reportRange,
  socialSummary,
  type PostRow,
  type Range,
  type Report,
  type ReportPeriod,
} from "./report";

// Builds a performance report for one shop and period: paid social spend and
// return, how its social posts did, Google Analytics and Ads, where it ranks,
// and what its competitors did, each beside the period before.

const DAY = 86400_000;
const start = (day: string) => new Date(`${day}T00:00:00Z`);
const end = (day: string) => new Date(start(day).getTime() + DAY - 1);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function performanceReport(
  shop: string,
  period: ReportPeriod,
  { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {},
): Promise<Report> {
  const range = reportRange(period, now);
  const [site, paid, social, google, search, competitors] = await Promise.all([
    shopDomain(shop),
    paidReport(shop, range, { f, now }),
    socialPart(shop, range),
    googlePart(shop),
    searchPart(shop, range),
    competitorPart(shop, range),
  ]);
  return {
    shop,
    site,
    range,
    createdAt: now.toISOString(),
    paid,
    social,
    google,
    search,
    competitors,
  };
}

async function socialPart(shop: string, r: Range): Promise<Report["social"]> {
  const [accounts, posts, followers] = await Promise.all([
    db.socialAccount.findMany({
      where: { shop },
      select: { id: true, network: true, name: true },
    }),
    db.socialPost.findMany({
      where: {
        shop,
        status: "posted",
        createdAt: { gte: start(r.prevSince), lte: end(r.until) },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.socialFollowers.findMany({
      where: { shop, day: { lte: r.until } },
      orderBy: { day: "asc" },
    }),
  ]);
  if (!accounts.length && !posts.length) return null;
  const name = new Map(accounts.map((a) => [a.id, a.name]));
  const rows = posts.map((p) => ({
    p,
    day: dayOf(p.createdAt),
    stats: readStats(p.stats),
  }));
  const cur = rows.filter((x) => x.day >= r.since);
  const prev = rows.filter((x) => x.day < r.since && x.day <= r.prevUntil);
  const networks = [...new Set(cur.map((x) => x.p.network as Network))];
  const top: PostRow[] = cur
    .filter((x) => x.stats && engagement(x.stats) !== undefined)
    .sort(
      (a, b) =>
        (engagement(b.stats as PostStats) ?? 0) -
        (engagement(a.stats as PostStats) ?? 0),
    )
    .slice(0, 5)
    .map(({ p, day, stats }) => ({
      network: p.network as Network,
      account: name.get(p.accountId) ?? "Disconnected account",
      text: p.caption.slice(0, 200),
      day,
      url: p.url,
      reach: stats?.reach,
      engagements: engagement(stats as PostStats),
    }));
  return {
    current: socialSummary(cur.map((x) => x.stats)),
    previous: socialSummary(prev.map((x) => x.stats)),
    byNetwork: networks
      .map((n) => ({
        network: n,
        ...socialSummary(
          cur.filter((x) => x.p.network === n).map((x) => x.stats),
        ),
      }))
      .sort((a, b) => (b.engagements ?? 0) - (a.engagements ?? 0)),
    top,
    followers: accounts
      .map((a) => {
        const mine = followers.filter((x) => x.accountId === a.id);
        // The count on the day the period started (or the latest before it), and at its end.
        const before =
          mine.filter((x) => x.day <= r.since).pop() ??
          mine.find((x) => x.day >= r.since);
        const last = mine[mine.length - 1];
        return {
          network: a.network as Network,
          name: a.name,
          start: before?.followers ?? null,
          end: last && last.day >= r.since ? last.followers : null,
        };
      })
      .filter((a) => a.end != null),
  };
}

async function googlePart(shop: string): Promise<Report["google"]> {
  const row = await db.googleConnection.findUnique({ where: { shop } });
  const rep = (row?.report ?? null) as GoogleReport | null;
  if (!row || !rep || (!rep.analytics && !rep.ads)) return null;
  const a = rep.analytics;
  const ads = rep.ads;
  return {
    checkedAt: row.checkedAt?.toISOString() ?? null,
    analytics: a
      ? {
          currency: a.currency,
          ...a.current,
          prevSessions: a.previous.sessions,
          prevRevenue: a.previous.revenue,
          prevPurchases: a.previous.purchases,
          channels: a.channels.slice(0, 6),
        }
      : null,
    ads: ads
      ? {
          currency: ads.currency,
          spend: ads.current.spend,
          clicks: ads.current.clicks,
          conversions: ads.current.conversions,
          value: ads.current.value,
          prevSpend: ads.previous.spend,
          prevValue: ads.previous.value,
        }
      : null,
  };
}

async function searchPart(shop: string, r: Range): Promise<Report["search"]> {
  const keywords = await db.trackedKeyword.findMany({ where: { shop } });
  if (!keywords.length) return null;
  const ids = new Set(keywords.map((k) => k.id));
  const rows = (
    await db.keywordRank.findMany({
      where: {
        shop,
        error: null,
        checkedAt: {
          gte: new Date(start(r.since).getTime() - 14 * DAY),
          lte: end(r.until),
        },
      },
      orderBy: { checkedAt: "asc" },
    })
  ).filter((x) => ids.has(x.keywordId));
  const checks = [...new Set(rows.map((x) => x.checkedAt.getTime()))].sort(
    (a, b) => a - b,
  );
  if (!checks.length) return null;
  const latest = checks[checks.length - 1];
  // The check nearest the start of the period, to compare with.
  const first =
    [...checks].reverse().find((t) => t <= start(r.since).getTime()) ??
    (checks[0] !== latest ? checks[0] : undefined);
  const on = (t: number | undefined) =>
    t == null ? [] : rows.filter((x) => x.checkedAt.getTime() === t);
  const count = (list: typeof rows, n: number) =>
    list.filter((x) => x.position != null && x.position <= n).length;
  const now = on(latest);
  const then = on(first);
  const word = new Map(keywords.map((k) => [k.id, k.keyword]));
  const was = new Map(then.map((x) => [x.keywordId, x.position]));
  const movers = now
    .filter((x) => was.has(x.keywordId) && was.get(x.keywordId) !== x.position)
    .map((x) => ({
      keyword: word.get(x.keywordId)!,
      from: was.get(x.keywordId) ?? null,
      to: x.position,
    }))
    .sort(
      (a, b) =>
        Math.abs((b.from ?? 31) - (b.to ?? 31)) -
        Math.abs((a.from ?? 31) - (a.to ?? 31)),
    )
    .slice(0, 8);
  return {
    tracked: keywords.length,
    top3: count(now, 3),
    top10: count(now, 10),
    prevTop3: first == null ? null : count(then, 3),
    prevTop10: first == null ? null : count(then, 10),
    movers,
  };
}

async function competitorPart(
  shop: string,
  r: Range,
): Promise<Report["competitors"]> {
  const competitors = await db.competitor.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });
  if (!competitors.length) return null;
  const ids = competitors.map((c) => c.id);
  const [snapshots, events, ads] = await Promise.all([
    db.trafficSnapshot.findMany({
      where: { competitorId: { in: ids }, takenAt: { lte: end(r.until) } },
      orderBy: { takenAt: "asc" },
    }),
    db.competitorEvent.findMany({
      where: {
        competitorId: { in: ids },
        kind: { not: "tracking" },
        createdAt: { gte: start(r.since), lte: end(r.until) },
      },
      select: { competitorId: true, kind: true },
    }),
    db.competitorAd.findMany({
      where: { competitorId: { in: ids } },
      select: { competitorId: true, active: true, firstSeenAt: true },
    }),
  ]);
  const kinds = new Map<string, number>();
  for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  return {
    rows: competitors.map((c) => {
      const mine = snapshots.filter((s) => s.competitorId === c.id);
      const latest = mine[mine.length - 1];
      const before = mine
        .filter((s) => s.takenAt.getTime() < start(r.since).getTime())
        .pop();
      const theirAds = ads.filter((a) => a.competitorId === c.id);
      return {
        name: c.name,
        organicTraffic: latest?.organicTraffic ?? c.organicTraffic,
        prevOrganicTraffic: before?.organicTraffic ?? null,
        paidCostCents: latest?.paidCostCents ?? c.paidCostCents,
        prevPaidCostCents: before?.paidCostCents ?? null,
        liveAds: theirAds.filter((a) => a.active).length,
        newAds: theirAds.filter(
          (a) =>
            a.firstSeenAt >= start(r.since) && a.firstSeenAt <= end(r.until),
        ).length,
        changes: events.filter((e) => e.competitorId === c.id).length,
      };
    }),
    events: [...kinds]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}
