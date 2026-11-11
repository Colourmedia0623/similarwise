// A competitor's products from its public Shopify catalogue (/products.json).

export type SeenProduct = {
  productId: string;
  handle: string;
  title: string;
  productType: string | null;
  priceCents: number;
  compareAtCents: number | null;
  publishedAt: Date | null;
  available: boolean; // False when every variant is sold out
  variantCount: number;
  soldOutOptions: string[]; // Names of the variants sold out, e.g. "UK 9 / Black"
};

type RawVariant = { title?: string; price?: string | number | null; compare_at_price?: string | number | null; available?: boolean };
type RawProduct = {
  id?: number | string;
  handle?: string;
  title?: string;
  product_type?: string;
  published_at?: string | null;
  variants?: RawVariant[];
};

const cents = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export function parseProducts(json: unknown): SeenProduct[] {
  const list = (json as { products?: RawProduct[] } | null)?.products;
  if (!Array.isArray(list)) return [];
  const out: SeenProduct[] = [];
  for (const p of list) {
    if (p?.id == null || !p.title) continue;
    const prices = (p.variants ?? []).map((v) => cents(v.price)).filter((c): c is number => c != null);
    if (!prices.length) continue;
    const compareAt = (p.variants ?? [])
      .map((v) => cents(v.compare_at_price))
      .filter((c): c is number => c != null && c > 0);
    const price = Math.min(...prices);
    const highestCompare = compareAt.length ? Math.max(...compareAt) : null;
    // Stores that hide stock leave `available` out: count those as in stock.
    const variants = p.variants ?? [];
    const available = !variants.length || variants.some((v) => v?.available !== false);
    const soldOutOptions = variants
      .filter((v) => v?.available === false)
      .map((v, i) => (v.title && v.title !== "Default Title" ? String(v.title).slice(0, 60) : `Option ${i + 1}`))
      .slice(0, MAX_OPTIONS);
    const published = p.published_at ? new Date(p.published_at) : null;
    out.push({
      productId: String(p.id),
      handle: String(p.handle ?? ""),
      title: String(p.title).slice(0, 300),
      productType: p.product_type ? String(p.product_type).slice(0, 120) : null,
      priceCents: price,
      compareAtCents: highestCompare != null && highestCompare > price ? highestCompare : null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      available,
      variantCount: variants.length,
      soldOutOptions,
    });
  }
  return out;
}

export const PAGE_LIMIT = 250;
const MAX_OPTIONS = 50;
export const MAX_PAGES = 20; // Up to 5,000 products per store.
