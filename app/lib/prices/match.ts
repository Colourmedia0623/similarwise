// Suggests which competitor product is the same as one of the shop's own, by
// how alike their titles are. Sizes and quantities count for a lot: "Gift
// box 12x12" and "Gift box 20x20" share most words but aren't the same thing.

export type Titled = { id: string; title: string; productType?: string | null };

const STOP = new Set(["a", "an", "and", "the", "with", "of", "for", "in", "by", "to", "on", "our", "new", "pack"]);

export function tokens(title: string): string[] {
  const t = title
    .toLowerCase()
    .replace(/&/g, " and ")
    // "12 x 12", "12×12" → "12x12"; "20 m" → "20m".
    .replace(/(\d)\s*[x×*]\s*(?=\d)/g, "$1x")
    .replace(/(\d)\s+(mm|cm|m|ml|l|g|kg|oz|in|inch|pcs|pc|pk)\b/g, "$1$2")
    .replace(/[^a-z0-9.x]+/g, " ");
  return [...new Set(t.split(" ").filter((w) => w && !STOP.has(w)).map((w) => w.replace(/^\.+|\.+$/g, "")))].filter(
    Boolean,
  );
}

const hasDigit = (w: string) => /\d/.test(w);

// 0 to 1: how likely two titles are the same product.
export function similarity(a: string[], b: string[], sameType = false): number {
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  const shared = a.filter((w) => bs.has(w)).length;
  let score = (2 * shared) / (a.length + b.length);
  const an = a.filter(hasDigit);
  const bn = b.filter(hasDigit);
  if (an.length && bn.length && !an.some((w) => bs.has(w))) score *= 0.5;
  if (sameType) score = Math.min(1, score + 0.1);
  return score;
}

export const MIN_SCORE = 0.55;

const sameType = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// Ranks candidates for one product, best first. Only candidates sharing at
// least one word are scored, so this stays quick for thousands of products.
export function rankCandidates<T extends Titled>(product: Titled, candidates: T[], limit = 10) {
  const index = buildIndex(candidates);
  return rankWithIndex(product, index, limit);
}

export type CandidateIndex<T extends Titled> = { items: { item: T; tokens: string[] }[]; byToken: Map<string, number[]> };

export function buildIndex<T extends Titled>(candidates: T[]): CandidateIndex<T> {
  const items = candidates.map((item) => ({ item, tokens: tokens(item.title) }));
  const byToken = new Map<string, number[]>();
  items.forEach((c, i) => {
    for (const w of c.tokens) {
      const list = byToken.get(w);
      if (list) list.push(i);
      else byToken.set(w, [i]);
    }
  });
  return { items, byToken };
}

export function rankWithIndex<T extends Titled>(product: Titled, index: CandidateIndex<T>, limit = 10) {
  const mine = tokens(product.title);
  const seen = new Set<number>();
  for (const w of mine) for (const i of index.byToken.get(w) ?? []) seen.add(i);
  return [...seen]
    .map((i) => {
      const c = index.items[i];
      return { item: c.item, score: similarity(mine, c.tokens, sameType(product.productType, c.item.productType)) };
    })
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// The best candidate, when it's alike enough to suggest.
export function bestMatch<T extends Titled>(product: Titled, index: CandidateIndex<T>) {
  const [top] = rankWithIndex(product, index, 1);
  return top && top.score >= MIN_SCORE ? top : null;
}

// How a competitor's price compares with the shop's, as a share of the shop's
// price: -0.1 means they're 10% cheaper.
export function priceGap(mineCents: number, theirsCents: number): number | null {
  if (mineCents <= 0) return null;
  return (theirsCents - mineCents) / mineCents;
}

// How a gap reads in the table, from the shop's point of view: a competitor
// selling for less is the one to worry about.
export function describeGap(gap: number | null): { label: string; tone: "critical" | "success" | "neutral" } {
  if (gap == null) return { label: "Other currency", tone: "neutral" };
  const pct = Math.round(Math.abs(gap) * 100);
  if (pct === 0) return { label: "Same price", tone: "neutral" };
  return gap < 0 ? { label: `${pct}% cheaper`, tone: "critical" } : { label: `${pct}% dearer`, tone: "success" };
}
