export { formatPrice } from "./tracker/diff";

// "3 hours ago", "2 days ago": when something happened, for activity feeds.
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [86400 * 30, "month"],
    [86400 * 7, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export const EVENT_LABEL: Record<string, string> = {
  tracking: "Tracking",
  launch: "New product",
  price_down: "Price cut",
  price_up: "Price rise",
  removed: "Taken down",
  app_added: "New app",
  app_removed: "App removed",
  channel_added: "New ad channel",
  channel_removed: "Ad channel dropped",
  theme_changed: "New theme",
  spend_up: "Ad spend up",
  spend_down: "Ad spend down",
  traffic_up: "Traffic up",
  traffic_down: "Traffic down",
  ad_launched: "New ads",
};

// "12k", "1.4M": big estimates read better rounded.
export function compact(n: number | null | undefined): string {
  if (n == null) return "–";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

// Branded search visits with their share of all search visits: "1.2K (34%)".
export function branded(visits: number | null | undefined, total: number | null | undefined): string {
  if (visits == null) return "–";
  return total ? `${compact(visits)} (${Math.round((visits / total) * 100)}%)` : compact(visits);
}

export const EVENT_TONE: Record<string, "info" | "success" | "warning" | "critical" | "neutral"> = {
  launch: "success",
  price_down: "warning",
  price_up: "info",
  removed: "neutral",
  channel_added: "info",
  ad_launched: "info",
  channel_removed: "neutral",
  spend_up: "warning",
  traffic_up: "warning",
};
