import db from "../../db.server";
import { hostOf } from "../tracker/url";
import { siteSources } from "./sources.server";

// Traffic and engagement: monthly visits over time, time on site, pages per
// visit, bounce rate and rank for the shop and each competitor, from the
// same weekly Similarweb read as the traffic sources.

export async function engagementOverview(shop: string) {
  const [s, competitors] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.competitor.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
  ]);
  const sites = [
    ...(s?.domain ? [{ id: "you", name: "You", domain: s.domain, you: true }] : []),
    ...competitors.filter((c) => hostOf(c.url) !== s?.domain).map((c) => ({ id: c.id, name: c.name, domain: hostOf(c.url), you: false })),
  ];
  const figures = await siteSources(sites.map((x) => x.domain));
  return {
    sites: sites.map((x) => {
      const f = figures.get(x.domain);
      return {
        ...x,
        visits: f?.visits ?? null,
        engagement: f?.engagement ?? null,
        error: f?.error ?? null,
        fetchedAt: f?.fetchedAt?.toISOString() ?? null,
      };
    }),
  };
}
