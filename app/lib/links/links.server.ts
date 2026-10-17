import db from "../../db.server";
import { hostOf } from "../tracker/url";
import { poster, taskResult } from "../traffic/dataforseo.server";
import { shopDomain } from "../traffic/gap.server";
import { claudeJson } from "../ideas/claude.server";

// The link gap: websites that link to a competitor but not to the shop, from
// DataForSEO Backlinks. Sites linking to several competitors come first, as
// they're the likeliest to link to the shop too, weighted by authority. Refreshed weekly; uses the
// same DataForSEO login as the search data, with Backlinks switched on.

const WEEK = 7 * 24 * 3600_000;
const LIMIT = 100;

export type LinkSite = { domain: string; rank: number | null; backlinks: number | null; firstSeen: Date | null };
export type LinksClient = { linkingSites(theirs: string, yours: string): Promise<LinkSite[]> };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export function parseLinkingSites(json: unknown): LinkSite[] {
  const items = (taskResult(json)[0]?.items ?? []) as { domain_intersection?: Record<string, Record<string, unknown>> }[];
  return items.flatMap((it) => {
    const d = it.domain_intersection?.["1"];
    const domain = typeof d?.target === "string" ? d.target.toLowerCase().replace(/^www\./, "") : "";
    if (!domain) return [];
    const seen = typeof d?.first_seen === "string" ? new Date(d.first_seen) : null;
    return [{ domain: domain.slice(0, 200), rank: num(d?.rank), backlinks: num(d?.backlinks), firstSeen: seen && !Number.isNaN(seen.getTime()) ? seen : null }];
  });
}

export function linksClient(): LinksClient | null {
  const post = poster();
  if (!post) return null;
  return {
    async linkingSites(theirs, yours) {
      return parseLinkingSites(
        await post("/backlinks/domain_intersection/live", {
          targets: { "1": theirs },
          exclude_targets: [yours],
          limit: LIMIT,
          order_by: ["1.rank,desc"],
          filters: ["1.backlinks_spam_score", "<", 30],
          backlinks_filters: [["dofollow", "=", true]],
          rank_scale: "one_hundred",
          include_subdomains: true,
        }),
      );
    },
  };
}

// DataForSEO refuses Backlinks calls until it's switched on for the account.
const friendly = (message: string) =>
  /access denied|subscri|not available|40204/i.test(message)
    ? "Backlinks aren't switched on for your DataForSEO account yet. Turn on Backlinks in DataForSEO, then press Refresh."
    : `Couldn't get the sites linking to them: ${message}`;

export async function refreshLinks(
  id: string,
  { client = linksClient(), force = false, now = new Date() }: { client?: LinksClient | null; force?: boolean; now?: Date } = {},
) {
  if (!client) return;
  const c = await db.competitor.findUnique({ where: { id } });
  if (!c) return;
  const yours = await shopDomain(c.shop);
  if (!yours) return;
  const theirs = hostOf(c.url);
  if (theirs === yours) return;
  const fresh = c.linksAt && now.getTime() - c.linksAt.getTime() < WEEK && c.linksDomain === yours;
  if (fresh && !force) return;
  try {
    const sites = (await client.linkingSites(theirs, yours)).filter((s) => s.domain !== yours && s.domain !== theirs);
    await db.$transaction([
      db.competitorLink.deleteMany({ where: { competitorId: id } }),
      db.competitorLink.createMany({ data: sites.map((s) => ({ competitorId: id, ...s })) }),
      db.competitor.update({ where: { id }, data: { linksAt: now, linksDomain: yours, linksError: null } }),
    ]);
  } catch (err) {
    const message = friendly(err instanceof Error ? err.message : String(err));
    await db.competitor.update({ where: { id }, data: { linksError: message.slice(0, 300) } });
  }
}

// Sites where the shop posts its own profile or work rather than asking anyone
// for a link, so they get "Post here" instead of an outreach email.
const PLATFORMS = [
  "pinterest.com", "behance.net", "dribbble.com", "instagram.com", "facebook.com", "youtube.com", "linkedin.com",
  "x.com", "twitter.com", "tiktok.com", "reddit.com", "medium.com", "tumblr.com", "flickr.com", "issuu.com",
  "quora.com", "etsy.com", "wordpress.com", "blogspot.com", "substack.com", "vimeo.com", "trustpilot.com",
];

export const isPlatform = (domain: string) => PLATFORMS.some((p) => domain === p || domain.endsWith(`.${p}`));

export type LinkRow = {
  domain: string;
  rank: number | null;
  platform: boolean;
  competitors: { id: string; name: string; backlinks: number | null }[];
};

// Authority times the number of competitors it links to, so a strong site
// linking to one competitor beats a worthless one linking to several.
const score = (r: LinkRow) => (r.rank ?? 0) * r.competitors.length;

// One row per linking site across the shop's competitors, worked out against
// its current website, best first.
export async function linkGap(shop: string) {
  const [domain, competitors] = await Promise.all([
    shopDomain(shop),
    db.competitor.findMany({ where: { shop }, orderBy: { createdAt: "asc" }, include: { links: true } }),
  ]);
  const own = new Set([domain, ...competitors.map((c) => hostOf(c.url))]);
  const rows = new Map<string, LinkRow>();
  for (const c of competitors) {
    if (c.linksDomain !== domain) continue;
    for (const l of c.links) {
      if (own.has(l.domain)) continue;
      const row = rows.get(l.domain) ?? { domain: l.domain, rank: l.rank, platform: isPlatform(l.domain), competitors: [] };
      if (l.rank != null) row.rank = Math.max(row.rank ?? 0, l.rank);
      row.competitors.push({ id: c.id, name: c.name, backlinks: l.backlinks });
      rows.set(l.domain, row);
    }
  }
  const sites = [...rows.values()].sort(
    (a, b) => score(b) - score(a) || b.competitors.length - a.competitors.length || (b.rank ?? 0) - (a.rank ?? 0) || a.domain.localeCompare(b.domain),
  );
  return {
    domain,
    competitors: competitors.map((c) => ({ id: c.id, name: c.name, ready: c.linksAt != null && c.linksDomain === domain, error: c.linksError })),
    sites,
    shared: sites.filter((s) => s.competitors.length > 1).length,
  };
}

// A short outreach email asking a site to link to the shop.
export type Pitch = { subject: string; body: string };

const PITCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: { subject: { type: "string" }, body: { type: "string" } },
};

const PITCH_SYSTEM = `You write short, friendly outreach emails for small online shops asking another website to link to them. You get the shop's website, a few of its products, the site being emailed, and which of the shop's competitors that site already links to.

Guess from the site's name what kind of site it is (a blog, a directory, a supplier, a news site) and pitch to suit: a product to feature, a listing to add, a guide to mention. Mention that it links to similar shops without naming the competitors. Keep the body under 120 words, plain text, with [Your name] as the signature. The subject is under 60 characters. No hype words, no flattery beyond one line.`;

export async function writePitch(shop: string, site: string, ask = claudeJson()): Promise<Pitch | { error: string }> {
  if (!ask) return { error: "Outreach emails aren't switched on for this app yet." };
  const gap = await linkGap(shop);
  const row = gap.sites.find((s) => s.domain === site);
  if (!row || !gap.domain) return { error: "That site isn't in your link gap any more." };
  const products = await db.shopProduct.findMany({ where: { shop }, select: { title: true }, take: 15 });
  const out = (await ask(
    PITCH_SYSTEM,
    { shopWebsite: gap.domain, products: products.map((p) => p.title), site: row.domain, linksTo: row.competitors.map((c) => c.name) },
    PITCH_SCHEMA,
  )) as Partial<Pitch> | null;
  const subject = typeof out?.subject === "string" ? out.subject.trim() : "";
  const body = typeof out?.body === "string" ? out.body.trim() : "";
  return subject && body ? { subject, body } : { error: "Couldn't write that email. Try again." };
}
