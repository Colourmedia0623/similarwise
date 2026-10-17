import db from "../db.server";

// Everything the app holds for a shop: its sessions, settings, its own
// products (for price comparison), its keyword and ad ideas, similar sites and the
// competitors it tracks (their products, keywords, events and snapshots go
// with them). Nothing about the shop's customers is stored.
export async function redactShop(shop: string) {
  const competitors = await db.competitor.deleteMany({ where: { shop } });
  await db.shopProduct.deleteMany({ where: { shop } });
  await db.keywordIdea.deleteMany({ where: { shop } });
  await db.adIdeas.deleteMany({ where: { shop } });
  await db.similarSite.deleteMany({ where: { shop } });
  await db.shopSettings.deleteMany({ where: { shop } });
  const sessions = await db.session.deleteMany({ where: { shop } });
  return { competitors: competitors.count, sessions: sessions.count };
}
