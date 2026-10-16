import type { SeenProduct } from "./products";

// What changed between a competitor's last check and this one.

export type Change = { kind: string; message: string };

export type KnownProduct = Pick<SeenProduct, "productId" | "title" | "priceCents">;

const MAX_PER_KIND = 25;

export function formatPrice(cents: number, currency: string | null): string {
  const amount = cents / 100;
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

// Caps each kind so a store relaunching its whole catalogue doesn't flood
// the feed: the rest become one summary line.
function capped(kind: string, messages: string[], summary: (n: number) => string): Change[] {
  const out = messages.slice(0, MAX_PER_KIND).map((message) => ({ kind, message }));
  if (messages.length > MAX_PER_KIND) out.push({ kind, message: summary(messages.length - MAX_PER_KIND) });
  return out;
}

export function diffProducts(before: KnownProduct[], after: SeenProduct[], currency: string | null): Change[] {
  const old = new Map(before.map((p) => [p.productId, p]));
  const seen = new Set(after.map((p) => p.productId));
  const launches: string[] = [];
  const up: string[] = [];
  const down: string[] = [];
  for (const p of after) {
    const prev = old.get(p.productId);
    if (!prev) {
      launches.push(`Launched “${p.title}” at ${formatPrice(p.priceCents, currency)}`);
    } else if (prev.priceCents !== p.priceCents) {
      const line = `“${p.title}” went from ${formatPrice(prev.priceCents, currency)} to ${formatPrice(p.priceCents, currency)}`;
      (p.priceCents > prev.priceCents ? up : down).push(line);
    }
  }
  const removed = before.filter((p) => !seen.has(p.productId)).map((p) => `Took down “${p.title}”`);
  return [
    ...capped("launch", launches, (n) => `…and launched ${n} more products`),
    ...capped("price_down", down, (n) => `…and cut the price of ${n} more products`),
    ...capped("price_up", up, (n) => `…and raised the price of ${n} more products`),
    ...capped("removed", removed, (n) => `…and took down ${n} more products`),
  ];
}

export function diffList(before: string[], after: string[], noun: "app" | "channel"): Change[] {
  const added = after.filter((x) => !before.includes(x));
  const gone = before.filter((x) => !after.includes(x));
  const label = noun === "app" ? "app" : "ad or analytics pixel";
  return [
    ...added.map((x) => ({ kind: `${noun}_added`, message: `Started using ${x} (${label})` })),
    ...gone.map((x) => ({ kind: `${noun}_removed`, message: `Stopped using ${x} (${label})` })),
  ];
}
