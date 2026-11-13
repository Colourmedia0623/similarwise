import type { PostStats } from "../lib/social/networks";

// How a sent post is doing, in a line: likes, comments, shares, saves,
// reach and clicks, leaving out what the network doesn't give.
const LABELS: [keyof PostStats, string, string][] = [
  ["likes", "like", "likes"],
  ["comments", "comment", "comments"],
  ["shares", "share", "shares"],
  ["saves", "save", "saves"],
  ["reach", "reached", "reached"],
  ["clicks", "click", "clicks"],
];

export function addStats(list: (PostStats | null | undefined)[]): PostStats | null {
  const have = list.filter((s): s is PostStats => !!s);
  if (!have.length) return null;
  const out: PostStats = {};
  for (const [k] of LABELS) {
    const vals = have.map((s) => s[k]).filter((v): v is number => typeof v === "number");
    if (vals.length) out[k] = vals.reduce((a, b) => a + b, 0);
  }
  return out;
}

export function StatLine({ stats, compact = false }: { stats: PostStats | null | undefined; compact?: boolean }) {
  if (!stats) return null;
  const parts = LABELS.filter(([k]) => typeof stats[k] === "number").map(([k, one, many]) => {
    const n = stats[k]!;
    return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
  });
  if (!parts.length) return null;
  return <span style={{ color: "#616161", fontSize: compact ? 12 : 13, fontStyle: "normal" }}>{parts.join(" · ")}</span>;
}
