import db from "../../db.server";
import { fetchPublic, type Fetcher } from "../tracker/fetch.server";

// A web workspace's own products, read from its website's public catalogue
// instead of the Shopify Admin API: Shopify stores' /products.json, or
// WooCommerce's Store API. They fill the same ShopProduct table, so price
// comparison, keyword ideas, ad ideas and articles work as they do on Shopify.

type Product = { productId: string; handle: string; title: string; productType: string | null; imageUrl: string | null; priceCents: number; currency: string };

const MAX_PAGES = 10;
const pause = () => (process.env.NODE_ENV === "test" ? Promise.resolve() : new Promise((r) => setTimeout(r, 500)));

async function readJson(fetcher: Fetcher, url: string) {
  const res = await fetcher(url, "application/json");
  if (res.status !== 200) return null;
  try {
    return JSON.parse(res.body) as unknown;
  } catch {
    return null;
  }
}

type ShopifyRaw = { id?: number | string; handle?: string; title?: string; product_type?: string; images?: { src?: string }[]; variants?: { price?: string }[] };

async function fromShopify(origin: string, fetcher: Fetcher, currency: string): Promise<Product[] | null> {
  const out: Product[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = (await readJson(fetcher, `${origin}/products.json?limit=250&page=${page}`)) as { products?: ShopifyRaw[] } | null;
    if (!Array.isArray(json?.products)) return page === 1 ? null : out;
    for (const p of json.products) {
      const prices = (p.variants ?? []).map((v) => Math.round(Number.parseFloat(v.price ?? "") * 100)).filter(Number.isFinite);
      if (p.id == null || !p.title || !prices.length) continue;
      out.push({
        productId: `web:shopify:${p.id}`,
        handle: String(p.handle ?? ""),
        title: String(p.title).slice(0, 300),
        productType: p.product_type ? String(p.product_type).slice(0, 120) : null,
        imageUrl: p.images?.[0]?.src ?? null,
        priceCents: Math.min(...prices),
        currency,
      });
    }
    if (json.products.length < 250) break;
    await pause();
  }
  return out;
}

type WooRaw = {
  id?: number;
  name?: string;
  slug?: string;
  categories?: { name?: string }[];
  images?: { src?: string }[];
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
};

async function fromWoo(origin: string, fetcher: Fetcher): Promise<Product[] | null> {
  const out: Product[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await readJson(fetcher, `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(json)) return page === 1 ? null : out;
    for (const p of json as WooRaw[]) {
      const minor = p.prices?.currency_minor_unit ?? 2;
      const raw = Number.parseInt(p.prices?.price ?? "", 10);
      if (p.id == null || !p.name || !Number.isFinite(raw)) continue;
      out.push({
        productId: `web:woo:${p.id}`,
        handle: String(p.slug ?? ""),
        // The Store API sends names with HTML entities, e.g. &amp;
        title: String(p.name).replace(/&amp;/g, "&").replace(/&#8217;/g, "’").replace(/&#039;/g, "'").slice(0, 300),
        productType: p.categories?.[0]?.name?.slice(0, 120) ?? null,
        imageUrl: p.images?.[0]?.src ?? null,
        priceCents: Math.round(raw * 10 ** (2 - minor)),
        currency: p.prices?.currency_code ?? "USD",
      });
    }
    if ((json as unknown[]).length < 100) break;
    await pause();
  }
  return out;
}

// products.json doesn't say its currency, so it's taken from the workspace's market.
const CURRENCY: Record<string, string> = { GB: "GBP", US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR" };

// A site with no readable catalogue isn't asked again for an hour.
const failed = new Map<string, { until: number; message: string }>();

// Copies the workspace's products from its website. Throws when the site has no catalogue we can read.
export async function syncWebProducts(shop: string, now = new Date(), fetcher: Fetcher = fetchPublic) {
  const f = failed.get(shop);
  if (f && f.until > now.getTime()) throw new Error(f.message);
  try {
    return await readAndStore(shop, now, fetcher);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failed.set(shop, { until: now.getTime() + 3_600_000, message });
    throw err;
  }
}

async function readAndStore(shop: string, now: Date, fetcher: Fetcher) {
  const ws = await db.workspace.findUnique({ where: { shop }, select: { website: true, country: true } });
  if (!ws?.website) throw new Error("Add your website in Settings so SimilarWise can read your products.");
  const origin = `https://${ws.website}`;
  const products =
    (await fromShopify(origin, fetcher, CURRENCY[ws.country ?? ""] ?? "USD").catch(() => null)) ??
    (await fromWoo(origin, fetcher).catch(() => null));
  if (!products) throw new Error(`Couldn't find a public product list on ${ws.website}. Price comparison works with Shopify and WooCommerce stores.`);
  for (const p of products) {
    const { productId, ...data } = p;
    await db.shopProduct.upsert({
      where: { shop_productId: { shop, productId } },
      create: { shop, productId, ...data, syncedAt: now },
      update: { ...data, syncedAt: now },
    });
  }
  await db.shopProduct.deleteMany({ where: { shop, productId: { notIn: products.map((p) => p.productId) } } });
  return products.length;
}
