import db from "../../db.server";
import { detectStorefront } from "./detect";
import { diffList, diffProducts, type Change } from "./diff";
import { fetchPublic, type Fetcher } from "./fetch.server";
import { MAX_PAGES, PAGE_LIMIT, parseProducts, type SeenProduct } from "./products";
import { hostOf, normalizeStoreUrl } from "./url";

// Adding competitors and checking their stores: the home page for the theme,
// apps and ad pixels, and (for Shopify stores) the public product catalogue
// for launches, price changes and products taken down.

export const MAX_COMPETITORS = 5;

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export async function addCompetitor(
  shop: string,
  input: string,
  fetcher: Fetcher = fetchPublic,
): Promise<{ id: string } | { error: string }> {
  const url = normalizeStoreUrl(input);
  if (!url) return { error: "Enter the competitor's website, like rival.com." };
  if (url === `https://${shop}` || hostOf(url) === shop) return { error: "That's your own store." };
  const count = await db.competitor.count({ where: { shop } });
  if (count >= MAX_COMPETITORS) return { error: `You can track up to ${MAX_COMPETITORS} competitors.` };
  const existing = await db.competitor.findUnique({ where: { shop_url: { shop, url } } });
  if (existing) return { error: `You're already tracking ${existing.name}.` };
  const c = await db.competitor.create({ data: { shop, url, name: hostOf(url) } });
  await checkCompetitor(c.id, fetcher);
  return { id: c.id };
}

async function fetchCatalogue(origin: string, fetcher: Fetcher): Promise<SeenProduct[] | null> {
  const all: SeenProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetcher(`${origin}/products.json?limit=${PAGE_LIMIT}&page=${page}`, "application/json");
    if (res.status !== 200) return page === 1 ? null : all;
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      return page === 1 ? null : all;
    }
    const batch = parseProducts(json);
    all.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    // Go gently on the competitor's store.
    if (process.env.NODE_ENV !== "test") await new Promise((r) => setTimeout(r, 750));
  }
  return all;
}

export async function checkCompetitor(id: string, fetcher: Fetcher = fetchPublic) {
  const c = await db.competitor.findUnique({ where: { id } });
  if (!c) return;
  const now = new Date();
  try {
    const home = await fetcher(c.url, "text/html");
    if (home.status >= 400) throw new Error(`The store answered with an error (${home.status})`);
    const front = detectStorefront(home.body);
    const catalogue = front.isShopify ? await fetchCatalogue(c.url, fetcher) : null;

    const firstCheck = !c.lastCheckedAt;
    const known = await db.competitorProduct.findMany({
      where: { competitorId: id, removedAt: null },
      select: { id: true, productId: true, title: true, priceCents: true },
    });

    const changes: Change[] = [];
    if (firstCheck) {
      changes.push({
        kind: "tracking",
        message: catalogue
          ? `Started tracking ${catalogue.length.toLocaleString()} products`
          : "Started tracking (product catalogue isn't public)",
      });
    } else {
      if (catalogue) changes.push(...diffProducts(known, catalogue, front.currency ?? c.currency));
      changes.push(...diffList(parseList(c.apps), front.apps, "app"));
      changes.push(...diffList(parseList(c.adChannels), front.adChannels, "channel"));
      if (front.theme && c.theme && front.theme !== c.theme)
        changes.push({ kind: "theme_changed", message: `Switched theme from ${c.theme} to ${front.theme}` });
    }

    const products = catalogue ?? [];
    const avg = products.length
      ? Math.round(products.reduce((s, p) => s + p.priceCents, 0) / products.length)
      : null;
    const onSale = products.filter((p) => p.compareAtCents != null).length;
    const byId = new Map(known.map((k) => [k.productId, k]));

    await db.$transaction(async (tx) => {
      if (catalogue) {
        const seen = new Set<string>();
        for (const p of catalogue) {
          if (seen.has(p.productId)) continue;
          seen.add(p.productId);
          const fields = {
            handle: p.handle,
            title: p.title,
            productType: p.productType,
            priceCents: p.priceCents,
            compareAtCents: p.compareAtCents,
            publishedAt: p.publishedAt,
            lastSeenAt: now,
            removedAt: null,
          };
          await tx.competitorProduct.upsert({
            where: { competitorId_productId: { competitorId: id, productId: p.productId } },
            create: { competitorId: id, productId: p.productId, firstSeenAt: now, ...fields },
            update: fields,
          });
          byId.delete(p.productId);
        }
        if (byId.size)
          await tx.competitorProduct.updateMany({
            where: { id: { in: [...byId.values()].map((k) => k.id) } },
            data: { removedAt: now },
          });
      }
      if (changes.length)
        await tx.competitorEvent.createMany({
          data: changes.map((ch) => ({ competitorId: id, kind: ch.kind, message: ch.message, createdAt: now })),
        });
      await tx.competitorSnapshot.create({
        data: {
          competitorId: id,
          takenAt: now,
          productCount: catalogue ? products.length : c.productCount,
          avgPriceCents: catalogue ? avg : c.avgPriceCents,
          onSaleCount: onSale,
        },
      });
      await tx.competitor.update({
        where: { id },
        data: {
          name: front.name ?? c.name,
          isShopify: front.isShopify,
          theme: front.theme,
          currency: front.currency ?? c.currency,
          apps: JSON.stringify(front.apps),
          adChannels: JSON.stringify(front.adChannels),
          ...(catalogue ? { productCount: products.length, avgPriceCents: avg } : {}),
          lastCheckedAt: now,
          lastError: catalogue || !front.isShopify ? null : "Couldn't read the product catalogue",
        },
      });
    }, { timeout: 60_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.competitor.update({
      where: { id },
      data: { lastCheckedAt: now, lastError: `Couldn't reach the store: ${message}`.slice(0, 300) },
    });
  }
}

export function parseStoredList(s: string) {
  return parseList(s);
}

export async function removeCompetitor(shop: string, id: string) {
  await db.competitor.deleteMany({ where: { id, shop } });
}

// Competitors not checked in the last day.
export async function staleCompetitors(now = new Date()) {
  const cutoff = new Date(now.getTime() - 24 * 3600_000);
  return db.competitor.findMany({
    where: { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }] },
    select: { id: true },
    orderBy: { lastCheckedAt: "asc" },
  });
}
