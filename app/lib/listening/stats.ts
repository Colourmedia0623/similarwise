// Counting for social listening: sentiment splits, weeks, and trending themes.
// Shared by the server and its tests; no database.

export type Sentiment = "positive" | "neutral" | "negative";

const DAY = 86400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export function splitOf(sentiments: (string | null)[]) {
  const s = { positive: 0, neutral: 0, negative: 0 };
  for (const x of sentiments) if (x === "positive" || x === "neutral" || x === "negative") s[x]++;
  return s;
}

// Net sentiment: the share of positive mentions less the share of negative
// ones, from -100 (all negative) to 100 (all positive). Null with nothing read.
export function net(s: { positive: number; neutral: number; negative: number }) {
  const total = s.positive + s.neutral + s.negative;
  return total ? Math.round((100 * (s.positive - s.negative)) / total) : null;
}

// The Mondays (UTC) starting the last n weeks, oldest first, the last being this week's.
export function weekStarts(now: Date, n: number) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = addDays(d, -((d.getUTCDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => addDays(monday, -7 * (n - 1 - i)));
}

export type ThemeTrend = {
  theme: string;
  week: number; // Mentions in the last seven days
  before: number; // Average a week over the three weeks before
  change: number | null; // Percent, null when it's new this week
  rising: boolean;
  positive: number;
  neutral: number;
  negative: number;
};

// The themes people talked about in the last seven days, against the three
// weeks before. Rising: new with at least two mentions, or up by half and by at least two.
export function themeTrends(mentions: { at: Date; sentiment: string | null; themes: string[] }[], now: Date): ThemeTrend[] {
  const weekAgo = addDays(now, -7);
  const monthAgo = addDays(now, -28);
  const map = new Map<string, { week: number; earlier: number; s: string[] }>();
  for (const m of mentions) {
    if (m.at < monthAgo || m.at > addDays(now, 1)) continue;
    const recent = m.at >= weekAgo;
    for (const t of new Set(m.themes)) {
      const e = map.get(t) ?? { week: 0, earlier: 0, s: [] };
      if (recent) {
        e.week++;
        e.s.push(m.sentiment ?? "neutral");
      } else e.earlier++;
      map.set(t, e);
    }
  }
  return [...map]
    .filter(([, e]) => e.week > 0)
    .map(([theme, e]) => {
      const before = Math.round((10 * e.earlier) / 3) / 10;
      const change = before > 0 ? Math.round((100 * (e.week - before)) / before) : null;
      return { theme, week: e.week, before, change, rising: before === 0 ? e.week >= 2 : e.week >= before * 1.5 && e.week - before >= 2, ...splitOf(e.s) };
    })
    .sort((a, b) => b.week - a.week || Number(b.rising) - Number(a.rising) || a.theme.localeCompare(b.theme));
}
