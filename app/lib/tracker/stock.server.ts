import db from "../../db.server";

// Competitor products that are sold out right now: every variant unavailable
// on their storefront at the last check. Ones the shop sells too come first,
// since those are the sales a shop can pick up while the competitor is out.

const MAX_LISTED = 500;

export async function soldOutProducts(shop: string) {
  const competitors = await db.competitor.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, url: true, currency: true, isShopify: true, productCount: true },
  });
  const products = await db.competitorProduct.findMany({
    where: { competitor: { shop }, removedAt: null, available: false },
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
      const yours = p.matches[0]?.shopProduct ?? null;
      return {
        id: p.id,
        title: p.title,
        productType: p.productType,
        url: `${c.url}/products/${p.handle}`,
        priceCents: p.priceCents,
        currency: c.currency,
        soldOutAt: p.soldOutAt?.toISOString() ?? null,
        competitor: { id: c.id, name: c.name },
        yours,
      };
    })
    .sort((a, b) => Number(b.yours != null) - Number(a.yours != null));
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.competitorId, (counts.get(p.competitorId) ?? 0) + 1);
  return {
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      isShopify: c.isShopify,
      productCount: c.productCount,
      soldOut: counts.get(c.id) ?? 0,
    })),
    rows,
    totals: { soldOut: products.length, youSell: rows.filter((r) => r.yours).length },
  };
}
