import db from "../../db.server";
import { checkCompetitor, parseStoredList } from "./check.server";

// Competitor products showing out of stock right now: sold out entirely
// (every variant unavailable at the last check), or with some sizes or
// options sold out. Ones the shop sells too come first, since those are the
// sales a shop can pick up while the competitor is out.

const MAX_LISTED = 1000;

export async function soldOutProducts(shop: string) {
  const competitors = await db.competitor.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, url: true, currency: true, isShopify: true, productCount: true, lastCheckedAt: true },
  });
  const products = await db.competitorProduct.findMany({
    where: { competitor: { shop }, removedAt: null, OR: [{ available: false }, { soldOutOptions: { not: "[]" } }] },
    orderBy: [{ soldOutAt: "desc" }, { title: "asc" }],
    take: MAX_LISTED,
    include: {
      matches: {
        where: { competitorProductId: { not: null } },
        select: { shopProduct: { select: { id: true, title: true, priceCents: true, currency: true } } },
      },
    },
  });
  const byId = new Map(competitors.map((c) => [c.id, c]));
  const rows = products
    .map((p) => {
      const c = byId.get(p.competitorId)!;
      return {
        id: p.id,
        title: p.title,
        productType: p.productType,
        url: `${c.url}/products/${p.handle}`,
        priceCents: p.priceCents,
        currency: c.currency,
        soldOut: p.available === false,
        soldOutOptions: parseStoredList(p.soldOutOptions),
        variantCount: p.variantCount,
        soldOutAt: p.soldOutAt?.toISOString() ?? null,
        competitor: { id: c.id, name: c.name },
        yours: p.matches[0]?.shopProduct ?? null,
      };
    })
    // Products the shop sells first, then whole products sold out.
    .sort((a, b) => Number(b.yours != null) - Number(a.yours != null) || Number(b.soldOut) - Number(a.soldOut));
  const count = (id: string, soldOut: boolean) => rows.filter((r) => r.competitor.id === id && r.soldOut === soldOut).length;
  return {
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      isShopify: c.isShopify,
      productCount: c.productCount,
      soldOut: count(c.id, true),
      partly: count(c.id, false),
    })),
    rows,
    checkedAt: competitors.reduce<Date | null>(
      (min, c) => (c.lastCheckedAt && (!min || c.lastCheckedAt < min) ? c.lastCheckedAt : min),
      null,
    )?.toISOString() ?? null,
    totals: {
      soldOut: rows.filter((r) => r.soldOut).length,
      partly: rows.filter((r) => !r.soldOut).length,
      youSell: rows.filter((r) => r.yours).length,
    },
  };
}

// Checks every one of the shop's Shopify competitors now, for fresh stock.
export async function checkStockNow(shop: string) {
  const competitors = await db.competitor.findMany({ where: { shop, isShopify: true }, select: { id: true } });
  for (const c of competitors) await checkCompetitor(c.id);
}
