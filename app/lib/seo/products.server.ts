import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import { fetchPublic, type Fetcher } from "../tracker/fetch.server";
import { isWebShop } from "../web/shop";
import type { Graphql } from "../prices/prices.server";

// Product SEO: the store's products with their title, SEO title and meta
// description, better ones suggested by Claude, and the merchant's approved
// (and perhaps changed) version written back to Shopify. Web workspaces have
// no Admin API, so their suggestions are there to copy into their own store.

import { LIMITS, PAGE_SIZE, type SeoProduct, type Suggestion } from "./products";

const PRODUCTS = `#graphql
  query SeoProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: TITLE) {
      nodes {
        id
        handle
        title
        productType
        description(truncateAt: 600)
        onlineStoreUrl
        seo { title description }
        featuredMedia { preview { image { url(transform: { maxWidth: 160 }) } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

type RawProduct = {
  id: string;
  handle: string;
  title: string;
  productType?: string | null;
  description?: string | null;
  onlineStoreUrl?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null;
};

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

// A page of the store's products, from Shopify, or from a web workspace's
// product list (its SEO fields are read from each product's page).
export async function seoProducts(shop: string, graphql: Graphql | null, opts: { after?: string | null; q?: string | null } = {}) {
  if (!isWebShop(shop) && graphql) {
    const res = (await graphql(PRODUCTS, { first: PAGE_SIZE, after: opts.after || null, query: opts.q ? `title:*${opts.q.replace(/[^\w\s-]/g, "")}*` : null })) as {
      data?: { products?: { nodes: RawProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
      errors?: { message: string }[];
    };
    if (!res.data?.products) throw new Error(res.errors?.[0]?.message ?? "Shopify didn't send the products.");
    const products: SeoProduct[] = res.data.products.nodes.map((p) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      seoTitle: blank(p.seo?.title),
      seoDescription: blank(p.seo?.description),
      description: p.description ?? "",
      productType: blank(p.productType),
      image: p.featuredMedia?.preview?.image?.url ?? null,
      url: p.onlineStoreUrl ?? null,
    }));
    return { products, next: res.data.products.pageInfo.hasNextPage ? res.data.products.pageInfo.endCursor : null, canApply: true };
  }
  // Web workspaces: the product list read from their website's public catalogue.
  const ws = await db.workspace.findUnique({ where: { shop }, select: { website: true } });
  const skip = Math.max(0, Number(opts.after) || 0);
  const where = { shop, ...(opts.q ? { title: { contains: opts.q } } : {}) };
  const rows = await db.shopProduct.findMany({ where, orderBy: { title: "asc" }, skip, take: PAGE_SIZE + 1 });
  const saved = new Map((await db.productSeo.findMany({ where: { shop, productId: { in: rows.map((r) => r.productId) } } })).map((s) => [s.productId, s]));
  const products: SeoProduct[] = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: r.productId,
    handle: r.handle,
    title: r.title,
    // What the page had when last read, kept with the suggestion.
    seoTitle: saved.get(r.productId)?.seoTitle ?? null,
    seoDescription: saved.get(r.productId)?.seoDescription ?? null,
    description: "",
    productType: r.productType,
    image: r.imageUrl,
    url: ws?.website && r.handle ? webProductUrl(ws.website, r.productId, r.handle) : null,
    unread: !saved.has(r.productId),
  }));
  return { products, next: rows.length > PAGE_SIZE ? String(skip + PAGE_SIZE) : null, canApply: false };
}

const webProductUrl = (website: string, productId: string, handle: string) =>
  productId.startsWith("web:woo:") ? `https://${website}/product/${handle}/` : `https://${website}/products/${handle}`;

// A web product page's <title> and meta description, and its words, for Claude.
export async function readProductPage(url: string, fetcher: Fetcher = fetchPublic) {
  try {
    const res = await fetcher(url, "text/html");
    if (res.status !== 200) return null;
    const html = res.body;
    const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const meta =
      html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1];
    const text = html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { seoTitle: title ? decode(title).slice(0, 300) : null, seoDescription: meta ? decode(meta).slice(0, 500) : null, text: decode(text).slice(0, 1500) };
  } catch {
    return null;
  }
}

export async function savedSuggestions(shop: string, productIds: string[]) {
  const rows = await db.productSeo.findMany({ where: { shop, productId: { in: productIds } } });
  return Object.fromEntries(
    rows.map((r) => [
      r.productId,
      { title: r.newTitle, seoTitle: r.newSeoTitle, seoDescription: r.newSeoDescription, why: r.why, appliedAt: r.appliedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() } satisfies Suggestion,
    ]),
  ) as Record<string, Suggestion>;
}

const SYSTEM = `You improve product SEO for a small online store. For each product you get its current title, SEO title (the page title shown in Google), meta description, type, and words from its description, plus the store's website and market.

For each product write:
- title: the product's name on the store. Keep it unless it's clearly unhelpful (vague, all capitals, stuffed with keywords, missing what the product is). Keep brand and model names, sizes and quantities. At most 120 characters.
- seoTitle: what shoppers search for first, then the detail that sets it apart, then the store's brand if it fits. 50 to 60 characters. Don't repeat words.
- seoDescription: a meta description of 140 to 155 characters, in plain sentences, saying what it is, who it's for or the main benefit, and a reason to click (such as delivery or range), only if the facts given support it.
- why: one short sentence on the main thing you changed and why.

Use only facts in what you're given; never invent materials, sizes, prices, offers or claims. Write in the market's spelling (British English for GB, IE, AU and NZ). No emoji, no quotation marks around the text, no ALL CAPS.`;

const SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, title: { type: "string" }, seoTitle: { type: "string" }, seoDescription: { type: "string" }, why: { type: "string" } },
        required: ["id", "title", "seoTitle", "seoDescription", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
};

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Suggestions for these products, kept until the merchant applies or asks again.
export async function suggestSeo(shop: string, products: SeoProduct[], { ask = claudeJson(), fetcher = fetchPublic }: { ask?: AskJson | null; fetcher?: Fetcher } = {}) {
  if (!ask) return { error: "Suggestions need Claude, which isn't switched on for this app yet." };
  if (!products.length) return { error: "Choose a product." };
  const [settings, ws] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop }, select: { market: true, domain: true } }),
    isWebShop(shop) ? db.workspace.findUnique({ where: { shop }, select: { website: true, country: true } }) : null,
  ]);
  // Web products: their page's current title and description, read now.
  const current = await Promise.all(
    products.map(async (p) => {
      if (!isWebShop(shop) || !p.url) return p;
      const page = await readProductPage(p.url, fetcher);
      return page ? { ...p, seoTitle: page.seoTitle, seoDescription: page.seoDescription, description: page.text } : p;
    }),
  );
  let answer: { products?: { id: string; title: string; seoTitle: string; seoDescription: string; why: string }[] };
  try {
    answer = (await ask(SYSTEM, {
      website: ws?.website ?? settings?.domain ?? null,
      market: ws?.country ?? settings?.market ?? "US",
      products: current.map((p) => ({ id: p.id, title: p.title, seoTitle: p.seoTitle, metaDescription: p.seoDescription, type: p.productType, description: p.description.slice(0, 800) })),
    }, SCHEMA)) as typeof answer;
  } catch (err) {
    console.error("Couldn't suggest product SEO", shop, err);
    return { error: "Couldn't write suggestions just now. Try again in a minute." };
  }
  const byId = new Map(current.map((p) => [p.id, p]));
  let saved = 0;
  for (const s of answer.products ?? []) {
    const p = byId.get(s.id);
    if (!p) continue;
    const data = {
      title: p.title,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      newTitle: clip(s.title, LIMITS.title) || p.title,
      newSeoTitle: clip(s.seoTitle, 70),
      newSeoDescription: clip(s.seoDescription, 170),
      why: clip(s.why, 300) || null,
      createdAt: new Date(),
      appliedAt: null,
    };
    await db.productSeo.upsert({ where: { shop_productId: { shop, productId: p.id } }, create: { shop, productId: p.id, ...data }, update: data });
    saved++;
  }
  return saved ? { ok: true as const, count: saved } : { error: "Claude didn't suggest anything for those products. Try again." };
}

const UPDATE = `#graphql
  mutation SeoUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id title seo { title description } }
      userErrors { field message }
    }
  }`;

// Writes the approved title, SEO title and meta description to the product
// on Shopify, as the merchant left them.
export async function applySeo(shop: string, graphql: Graphql, productId: string, values: { title: string; seoTitle: string; seoDescription: string }) {
  if (isWebShop(shop)) return { error: "Applying changes needs your store connected through the SimilarWise Shopify app. Copy the text into your store instead." };
  const title = clip(values.title, 255);
  const seoTitle = clip(values.seoTitle, 255);
  const seoDescription = clip(values.seoDescription, 320);
  if (!title) return { error: "The product needs a title." };
  const res = (await graphql(UPDATE, { product: { id: productId, title, seo: { title: seoTitle || null, description: seoDescription || null } } })) as {
    data?: { productUpdate?: { product?: { id: string } | null; userErrors?: { message: string }[] } };
    errors?: { message: string }[];
  };
  const problem = res.data?.productUpdate?.userErrors?.[0]?.message ?? res.errors?.[0]?.message;
  if (problem || !res.data?.productUpdate?.product) {
    const scope = /access|scope|permission/i.test(problem ?? "");
    return { error: scope ? "SimilarWise needs permission to change products. Open the app from Shopify admin and accept the update, then try again." : `Shopify said: ${problem ?? "the change didn't go through."}` };
  }
  const data = { newTitle: title, newSeoTitle: seoTitle, newSeoDescription: seoDescription, appliedAt: new Date() };
  await db.productSeo.upsert({
    where: { shop_productId: { shop, productId } },
    create: { shop, productId, title, seoTitle: null, seoDescription: null, ...data },
    update: data,
  });
  return { ok: true as const };
}
