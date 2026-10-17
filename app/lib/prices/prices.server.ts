import db from "../../db.server";
import { bestMatch, buildIndex, priceGap, rankCandidates, similarity, tokens } from "./match";

// The shop's own products, matched against its competitors' products so it
// can see where it's cheaper or dearer.

export type Graphql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

const SYNC_EVERY = 6 * 3600_000;
const MAX_PAGES = 10; // Up to 2,500 products.

const PRODUCTS = `#graphql
  query Products($after: String) {
    products(first: 250, after: $after, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        productType
        priceRangeV2 { minVariantPrice { amount currencyCode } }
      }
    }
  }`;

type ProductsPage = {
  data?: {
    products?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        id: string;
        handle: string;
        title: string;
        productType: string | null;
        priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
      }[];
    };
  };
};

// Copies the shop's active products from Shopify, dropping ones no longer there.
export async function syncShopProducts(shop: string, graphql: Graphql, now = new Date()) {
  const seen: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await graphql(PRODUCTS, { after })) as ProductsPage;
    const products = res.data?.products;
    if (!products) throw new Error("Shopify didn't return the shop's products");
    for (const p of products.nodes) {
      const price = Math.round(Number.parseFloat(p.priceRangeV2.minVariantPrice.amount) * 100);
      if (!Number.isFinite(price)) continue;
      const data = {
        handle: p.handle,
        title: p.title.slice(0, 300),
        productType: p.productType?.slice(0, 120) || null,
        priceCents: price,
        currency: p.priceRangeV2.minVariantPrice.currencyCode,
        syncedAt: now,
      };
      await db.shopProduct.upsert({
        where: { shop_productId: { shop, productId: p.id } },
        create: { shop, productId: p.id, ...data },
        update: data,
      });
      seen.push(p.id);
    }
    if (!products.pageInfo.hasNextPage) break;
    after = products.pageInfo.endCursor;
  }
  await db.shopProduct.deleteMany({ where: { shop, productId: { notIn: seen } } });
  return seen.length;
}

export async function syncIfStale(shop: string, graphql: Graphql, now = new Date()) {
  const last = await db.shopProduct.findFirst({ where: { shop }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } });
  if (last && now.getTime() - last.syncedAt.getTime() < SYNC_EVERY) return false;
  await syncShopProducts(shop, graphql, now);
  return true;
}

const liveProducts = (competitorId: string) =>
  db.competitorProduct.findMany({
    where: { competitorId, removedAt: null },
    select: { id: true, title: true, productType: true },
  });

// Suggests a match for each of the shop's products at each competitor, where
// there isn't one yet. Matches the merchant chose or turned down stay as they are.
export async function suggestMatches(shop: string) {
  const [own, competitors] = await Promise.all([
    db.shopProduct.findMany({ where: { shop }, select: { id: true, title: true, productType: true } }),
    db.competitor.findMany({ where: { shop }, select: { id: true } }),
  ]);
  let added = 0;
  for (const c of competitors) {
    const done = new Set(
      (await db.productMatch.findMany({ where: { competitorId: c.id }, select: { shopProductId: true } })).map(
        (m) => m.shopProductId,
      ),
    );
    const todo = own.filter((p) => !done.has(p.id));
    if (!todo.length) continue;
    const index = buildIndex(await liveProducts(c.id));
    for (const p of todo) {
      const best = bestMatch(p, index);
      if (!best) continue;
      await db.productMatch.create({
        data: { shopProductId: p.id, competitorId: c.id, competitorProductId: best.item.id, score: best.score },
      });
      added++;
    }
  }
  return added;
}

// Sets (or clears, with null) the competitor product a shop product matches.
export async function setMatch(shop: string, shopProductId: string, competitorId: string, competitorProductId: string | null) {
  const [own, competitor] = await Promise.all([
    db.shopProduct.findFirst({ where: { id: shopProductId, shop } }),
    db.competitor.findFirst({ where: { id: competitorId, shop } }),
  ]);
  if (!own || !competitor) return false;
  if (competitorProductId) {
    const p = await db.competitorProduct.findFirst({ where: { id: competitorProductId, competitorId } });
    if (!p) return false;
  }
  const data = { competitorProductId, confirmed: true, score: null };
  await db.productMatch.upsert({
    where: { shopProductId_competitorId: { shopProductId, competitorId } },
    create: { shopProductId, competitorId, ...data },
    update: data,
  });
  return true;
}

export async function confirmMatch(shop: string, matchId: string) {
  const m = await db.productMatch.findFirst({ where: { id: matchId, shopProduct: { shop } } });
  if (!m) return false;
  await db.productMatch.update({ where: { id: m.id }, data: { confirmed: true } });
  return true;
}

type Cell = {
  matchId: string;
  title: string;
  url: string;
  priceCents: number;
  currency: string | null;
  gap: number | null;
  confirmed: boolean;
  removed: boolean;
} | null;

// The comparison table: the shop's matched products, with each competitor's
// price for the same product.
export async function priceComparison(shop: string) {
  const competitors = await db.competitor.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, url: true, currency: true },
  });
  const own = await db.shopProduct.findMany({
    where: { shop },
    orderBy: { title: "asc" },
    include: { matches: { include: { competitorProduct: true } } },
  });
  const rows = own.map((p) => {
    const cells: Cell[] = competitors.map((c) => {
      const m = p.matches.find((x) => x.competitorId === c.id);
      const cp = m?.competitorProduct;
      if (!m || !cp) return null;
      const comparable = !c.currency || c.currency === p.currency;
      return {
        matchId: m.id,
        title: cp.title,
        url: `${c.url}/products/${cp.handle}`,
        priceCents: cp.priceCents,
        currency: c.currency,
        gap: comparable ? priceGap(p.priceCents, cp.priceCents) : null,
        confirmed: m.confirmed,
        removed: cp.removedAt != null,
      };
    });
    return { id: p.id, title: p.title, priceCents: p.priceCents, currency: p.currency, cells };
  });
  const matched = rows.filter((r) => r.cells.some((c) => c && !c.removed));
  const gaps = matched.flatMap((r) => r.cells.filter((c) => c && !c.removed && c.gap != null).map((c) => c!.gap!));
  return {
    competitors: competitors.map((c) => ({ id: c.id, name: c.name })),
    rows: matched,
    totals: {
      products: rows.length,
      matched: matched.length,
      // Rows where at least one competitor sells the same thing for less.
      undercut: matched.filter((r) => r.cells.some((c) => c && !c.removed && c.gap != null && c.gap < 0)).length,
      cheapest: matched.filter((r) => r.cells.every((c) => !c || c.removed || c.gap == null || c.gap >= 0)).length,
      averageGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    },
  };
}

// One of the shop's products with its matches and the likeliest candidates at
// each competitor, for picking the right match by hand. A search narrows the
// candidates to titles containing every word searched for.
export async function productMatches(shop: string, shopProductId: string, search = "") {
  const p = await db.shopProduct.findFirst({
    where: { id: shopProductId, shop },
    include: { matches: { include: { competitorProduct: true } } },
  });
  if (!p) return null;
  const competitors = await db.competitor.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
  const words = tokens(search);
  const mine = tokens(p.title);
  const result = [];
  for (const c of competitors) {
    const all = await db.competitorProduct.findMany({
      where: { competitorId: c.id, removedAt: null },
      select: { id: true, title: true, productType: true, handle: true, priceCents: true },
    });
    const pool = words.length ? all.filter((x) => words.every((w) => tokens(x.title).includes(w))) : all;
    // A search lists every title it finds, likeliest first; otherwise only
    // titles that share a word with the shop's product.
    const ranked = words.length
      ? pool
          .map((item) => ({ item, score: similarity(mine, tokens(item.title)) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
      : rankCandidates(p, pool, 10);
    const m = p.matches.find((x) => x.competitorId === c.id);
    result.push({
      id: c.id,
      name: c.name,
      url: c.url,
      currency: c.currency,
      match: m
        ? {
            id: m.id,
            confirmed: m.confirmed,
            none: m.competitorProductId == null,
            product: m.competitorProduct
              ? { id: m.competitorProduct.id, title: m.competitorProduct.title, handle: m.competitorProduct.handle, priceCents: m.competitorProduct.priceCents }
              : null,
          }
        : null,
      candidates: ranked.map((r) => ({
        id: r.item.id,
        title: r.item.title,
        handle: r.item.handle,
        priceCents: r.item.priceCents,
        score: r.score,
      })),
    });
  }
  return { product: { id: p.id, title: p.title, priceCents: p.priceCents, currency: p.currency }, competitors: result };
}
