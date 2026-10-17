import db from "../../db.server";
import { claudeJson } from "./claude.server";

// Ad ideas: what competitors' running ads keep coming back to (offers, hooks,
// formats), with the longest-running ads counting most since they're likely
// the ones that work, and 3 to 5 ads the shop could run for its own products.
// Off unless ANTHROPIC_API_KEY is set.

const ADS = 60;
const PRODUCTS = 150;
const DAY = 24 * 3600_000;

export type AdsInput = {
  competitors: string[];
  ads: { competitor: string; platform: string; daysRunning: number | null; format: string | null; cta: string | null; title: string | null; text: string | null }[];
  products: { ref: number; title: string; type: string | null; price: string }[];
};

export type Pattern = { theme: string; detail: string; competitors: string[] };
export type AdIdea = {
  productRef: number | null;
  product: string;
  platform: "meta" | "tiktok";
  angle: string;
  headline: string;
  primaryText: string;
  cta: string;
  visual: string;
  why: string;
};
export type AdIdeasClient = { ideas(input: AdsInput): Promise<{ patterns: Pattern[]; ideas: AdIdea[] }> };

const str = { type: "string" } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["patterns", "ideas"],
  properties: {
    patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["theme", "detail", "competitors"],
        properties: { theme: str, detail: str, competitors: { type: "array", items: str } },
      },
    },
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productRef", "product", "platform", "angle", "headline", "primaryText", "cta", "visual", "why"],
        properties: {
          productRef: { type: ["integer", "null"] },
          product: str,
          platform: { type: "string", enum: ["meta", "tiktok"] },
          angle: str,
          headline: str,
          primaryText: str,
          cta: str,
          visual: str,
          why: str,
        },
      },
    },
  },
};

const SYSTEM = `You are a performance marketer for Shopify stores. You get the ads a store's competitors are running now (Meta, TikTok and Google), each with how many days it has been running, and the store's products.

First, find 3 to 6 patterns across the competitors' ads: offers (free delivery, discounts, bundles), hooks and claims (eco, personalised, fast dispatch), formats (video, carousel, user-generated style) and calls to action. Ads that have run longest are most likely working, so weigh them most. For each pattern, give a short theme, one or two sentences of detail quoting or paraphrasing real ads, and which competitors use it.

Then write 3 to 5 ads the store could run on Meta or TikTok, each for one of its products (set productRef to its ref) or for the range (productRef null, product "Whole range"). Borrow what's working but give each a distinct angle, and don't copy competitors' wording or name them. Write in the store's customers' spelling, with no hype words.
- headline: under 40 characters.
- primaryText: 1 to 3 short sentences, under 250 characters.
- cta: one of Shop now, Learn more, Order now, Get offer.
- visual: what the picture or first 3 seconds of video should show.
- why: one sentence linking the idea to the pattern it uses.`;

export function adIdeasClient(): AdIdeasClient | null {
  const ask = claudeJson();
  return ask && { ideas: async (input) => parseAdIdeas(await ask(SYSTEM, input, SCHEMA)) };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseAdIdeas(json: unknown): { patterns: Pattern[]; ideas: AdIdea[] } {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);
  const patterns = list(o.patterns).flatMap((p) => {
    const theme = text(p.theme, 120);
    return theme
      ? [{ theme, detail: text(p.detail, 600), competitors: (Array.isArray(p.competitors) ? p.competitors : []).map((c) => text(c, 100)).filter(Boolean) }]
      : [];
  });
  const ideas = list(o.ideas).flatMap((i) => {
    const headline = text(i.headline, 80);
    if (!headline) return [];
    return [
      {
        productRef: Number.isInteger(i.productRef) ? (i.productRef as number) : null,
        product: text(i.product, 200),
        platform: i.platform === "tiktok" ? ("tiktok" as const) : ("meta" as const),
        angle: text(i.angle, 120),
        headline,
        primaryText: text(i.primaryText, 500),
        cta: text(i.cta, 40),
        visual: text(i.visual, 400),
        why: text(i.why, 300),
      },
    ];
  });
  return { patterns, ideas };
}

export async function refreshAdIdeas(shop: string, client: AdIdeasClient | null = adIdeasClient(), now = new Date()) {
  if (!client) return { error: "Ad ideas aren't switched on for this app yet." };
  const [competitors, ads, products] = await Promise.all([
    db.competitor.findMany({ where: { shop }, select: { name: true } }),
    db.competitorAd.findMany({
      where: { competitor: { shop }, active: true, OR: [{ title: { not: null } }, { text: { not: null } }] },
      include: { competitor: { select: { name: true } } },
      orderBy: [{ startedAt: { sort: "asc", nulls: "last" } }, { firstSeenAt: "asc" }],
      take: ADS,
    }),
    db.shopProduct.findMany({ where: { shop }, orderBy: { title: "asc" }, take: PRODUCTS }),
  ]);
  if (!ads.length) return { error: "There are no competitor ads yet. Refresh the Ads page first." };

  const found = await client.ideas({
    competitors: competitors.map((c) => c.name),
    ads: ads.map((a) => ({
      competitor: a.competitor.name,
      platform: a.platform,
      daysRunning: a.startedAt ? Math.max(0, Math.round((now.getTime() - a.startedAt.getTime()) / DAY)) : null,
      format: a.format,
      cta: a.cta,
      title: a.title?.slice(0, 200) ?? null,
      text: a.text?.slice(0, 600) ?? null,
    })),
    products: products.map((p, i) => ({ ref: i, title: p.title, type: p.productType, price: `${(p.priceCents / 100).toFixed(2)} ${p.currency}` })),
  });
  const ideas = found.ideas.map(({ productRef, ...i }) => {
    const p = productRef != null ? products[productRef] : undefined;
    return { ...i, product: p?.title ?? (i.product || "Whole range"), productId: p?.productId ?? null };
  });
  const data = { patterns: JSON.stringify(found.patterns), ideas: JSON.stringify(ideas), adsRead: ads.length, createdAt: now };
  await db.adIdeas.upsert({ where: { shop }, create: { shop, ...data }, update: data });
  return { count: ideas.length };
}

export type StoredAdIdea = Omit<AdIdea, "productRef"> & { productId: string | null };

export async function adIdeas(shop: string) {
  const row = await db.adIdeas.findUnique({ where: { shop } });
  return {
    patterns: row ? (JSON.parse(row.patterns) as Pattern[]) : [],
    ideas: row ? (JSON.parse(row.ideas) as StoredAdIdea[]) : [],
    adsRead: row?.adsRead ?? 0,
    createdAt: row?.createdAt ?? null,
  };
}
