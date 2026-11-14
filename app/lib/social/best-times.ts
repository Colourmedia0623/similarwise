import type { Network, PostStats } from "./networks";
import { zoned } from "./when";

// The best times to post on a day, for the composer: the hours the shop's
// own posts did best at, from their likes and reach, on the shop's clock.
// Until there are enough posts with figures to tell, it suggests typical
// good times for the networks picked.

export type SentPost = { network: Network; at: string; stats: PostStats | null | undefined };
export type BestTime = { time: string; stars: number };
export type BestTimes = { times: BestTime[]; fromPosts: number };

// Posts with figures needed, across at least MIN_HOURS hours, before the
// shop's own history is trusted over the typical times.
export const MIN_POSTS = 10;
const MIN_HOURS = 3;
const HISTORY_DAYS = 120;
// How far a few posts at an hour pull its score away from average.
const PRIOR = 2;

// Typical good hours for each network, as weights from 0 to 1.
const TYPICAL: Record<Network, Record<number, number>> = {
  facebook: { 8: 0.7, 9: 0.9, 10: 0.8, 12: 0.85, 13: 1, 15: 0.75, 19: 0.8, 20: 0.7 },
  instagram: { 7: 0.7, 9: 0.75, 11: 0.9, 12: 0.85, 13: 0.8, 17: 0.75, 19: 1, 20: 0.85 },
  pinterest: { 12: 0.7, 14: 0.75, 20: 1, 21: 0.95, 22: 0.8 },
  tiktok: { 7: 0.7, 12: 0.75, 15: 0.8, 18: 0.85, 19: 0.95, 21: 1 },
  linkedin: { 8: 0.9, 9: 1, 10: 0.85, 12: 0.8, 17: 0.7 },
};

function engagements(s: PostStats) {
  const parts = [s.likes, s.comments, s.shares, s.saves, s.clicks].filter((v): v is number => typeof v === "number");
  return parts.length ? parts.reduce((a, b) => a + b, 0) : undefined;
}

// How well each hour did. Each post is measured against the average for its
// network (engagement rate where the network gives reach, otherwise
// engagements), so a busy network doesn't drown out a quiet one.
function hourScores(posts: SentPost[], tz: string) {
  const measured = posts.flatMap((p) => {
    if (!p.stats) return [];
    const eng = engagements(p.stats);
    if (eng === undefined) return [];
    const value = p.stats.reach ? eng / p.stats.reach : p.stats.reach === 0 ? undefined : eng;
    return value === undefined ? [] : [{ network: p.network, value, hour: Number(zoned(new Date(p.at), tz).time.slice(0, 2)) }];
  });
  const average = new Map<Network, number>();
  for (const n of new Set(measured.map((m) => m.network))) {
    const vals = measured.filter((m) => m.network === n).map((m) => m.value);
    average.set(n, vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const byHour = new Map<number, number[]>();
  for (const m of measured) {
    const avg = average.get(m.network)!;
    if (!avg) continue;
    byHour.set(m.hour, [...(byHour.get(m.hour) ?? []), m.value / avg]);
  }
  const scores = new Map<number, number>();
  for (const [hour, vals] of byHour) scores.set(hour, (vals.reduce((a, b) => a + b, 0) + PRIOR) / (vals.length + PRIOR));
  return { scores, count: [...byHour.values()].reduce((a, v) => a + v.length, 0) };
}

export function bestTimes({
  sent,
  networks,
  day,
  tz,
  now,
  taken = [],
}: {
  sent: SentPost[];
  networks: Network[];
  day: string;
  tz: string;
  now: Date;
  taken?: string[];
}): BestTimes {
  const nets = networks.length ? networks : (Object.keys(TYPICAL) as Network[]);
  const since = now.getTime() - HISTORY_DAYS * 86400_000;
  const recent = sent.filter((p) => nets.includes(p.network) && Date.parse(p.at) >= since);
  const { scores, count } = hourScores(recent, tz);
  const fromPosts = count >= MIN_POSTS && scores.size >= MIN_HOURS ? count : 0;
  if (!fromPosts) {
    scores.clear();
    for (const n of nets) for (const [h, w] of Object.entries(TYPICAL[n])) scores.set(Number(h), (scores.get(Number(h)) ?? 0) + w / nets.length);
  }

  // Later today only, and not in the small hours.
  const here = zoned(now, tz);
  const from = day < here.day ? 24 : day === here.day ? Number(here.time.slice(0, 2)) + 1 : 0;
  const ranked = [...scores]
    .filter(([h, s]) => h >= Math.max(from, 6) && h <= 22 && s > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  // Three hours, spread at least two hours apart.
  const picked: [number, number][] = [];
  for (const r of ranked) {
    if (picked.length === 3) break;
    if (picked.every(([h]) => Math.abs(h - r[0]) >= 2)) picked.push(r);
  }
  if (!picked.length) return { times: [], fromPosts };
  const top = picked[0][1];
  // A quarter past (or quarter to) rather than on the hour, when most posts
  // go out, and clear of the shop's own posts already at that time.
  const clash = (t: string) => taken.some((x) => Math.abs(minutes(x) - minutes(t)) < 15);
  const times = picked
    .map(([h, s]) => {
      const hh = String(h).padStart(2, "0");
      const time = [`${hh}:15`, `${hh}:45`, `${hh}:30`, `${hh}:00`].find((t) => !clash(t)) ?? `${hh}:15`;
      return { time, stars: Math.max(3, 5 - Math.round((10 * (top - s)) / top)) };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
  return { times, fromPosts };
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Average reach of a post by the day of the week and hour it went out, on
// the shop's clock, for the report's heatmap. Days run Monday (0) to Sunday
// (6). Where no post has reach, it falls back to engagements.
export type TimeCell = { weekday: number; hour: number; posts: number; average: number };

export function postingHeatmap(sent: SentPost[], tz: string) {
  const withStats = sent.filter((p): p is SentPost & { stats: PostStats } => !!p.stats);
  const byReach = withStats.some((p) => typeof p.stats.reach === "number");
  const cells = new Map<string, { weekday: number; hour: number; values: number[] }>();
  for (const p of withStats) {
    const value = byReach ? p.stats.reach : engagements(p.stats);
    if (typeof value !== "number") continue;
    const { day, time } = zoned(new Date(p.at), tz);
    const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    const hour = Number(time.slice(0, 2));
    const key = `${weekday}:${hour}`;
    const cell = cells.get(key) ?? { weekday, hour, values: [] };
    cell.values.push(value);
    cells.set(key, cell);
  }
  const list: TimeCell[] = [...cells.values()].map((c) => ({
    weekday: c.weekday,
    hour: c.hour,
    posts: c.values.length,
    average: c.values.reduce((a, b) => a + b, 0) / c.values.length,
  }));
  const hours = list.map((c) => c.hour);
  return {
    measure: byReach ? ("reach" as const) : ("engagements" as const),
    cells: list,
    // Office hours and evenings at least, wider if posts went out earlier or later.
    from: Math.min(6, ...hours),
    to: Math.max(22, ...hours),
  };
}
