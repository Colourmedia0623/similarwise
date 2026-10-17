import db from "../../db.server";
import { keywordGap } from "../traffic/gap.server";
import { claudeJson } from "./claude.server";

// Keyword ideas: for the searches competitors win and the shop misses (or
// trails on), which of the shop's pages should target each one, with a page
// title, meta description and opening paragraph to use. Claude writes them
// from the keyword gap and the shop's product titles. Off unless
// ANTHROPIC_API_KEY is set.

const KEYWORDS = 40;
const PRODUCTS = 400;

export type IdeasInput = {
  website: string;
  market: string;
  competitors: string[];
  keywords: { keyword: string; searches: number | null; yourPosition: number | null; bestCompetitor: string | null }[];
  products: { ref: number; title: string; type: string | null }[];
};

export type Idea = {
  keyword: string;
  productRef: number | null;
  pageKind: "product" | "collection" | "blog";
  pageName: string;
  seoTitle: string;
  metaDescription: string;
  intro: string;
  why: string;
};

export type IdeasClient = { ideas(input: IdeasInput): Promise<Idea[]> };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keyword", "productRef", "pageKind", "pageName", "seoTitle", "metaDescription", "intro", "why"],
        properties: {
          keyword: { type: "string" },
          productRef: { type: ["integer", "null"] },
          pageKind: { type: "string", enum: ["product", "collection", "blog"] },
          pageName: { type: "string" },
          seoTitle: { type: "string" },
          metaDescription: { type: "string" },
          intro: { type: "string" },
          why: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You are an SEO specialist for Shopify stores. You get a store's website, the searches its competitors win on Google that the store doesn't rank for (or ranks below them on), and the store's product titles.

Pick the 10 to 15 searches most worth winning: ones a shopper could buy from this store on, with the most searches. Skip searches for a competitor's brand name, and searches for things the store doesn't appear to sell. Group near-identical searches under the biggest one.

For each, say which page should target it:
- "product": one of the store's existing products clearly matches. Set productRef to its ref and pageName to its title.
- "collection": several products fit, or a category page would rank better. Name the collection to create or improve; productRef is null.
- "blog": the search is a question or guide ("how to", "ideas", "best"). Name the post; productRef is null.

Then write, in the store's market's spelling:
- seoTitle: under 60 characters, the search near the start, the store's brand at the end if it fits.
- metaDescription: under 155 characters, says what the shopper gets and why to click, no hype.
- intro: 2 or 3 plain sentences for the top of the page that use the search naturally.
- why: one sentence on why this search is worth it, naming the competitor that ranks and the monthly searches.`;

export function ideasClient(): IdeasClient | null {
  const ask = claudeJson();
  return ask && { ideas: async (input) => parseIdeas(await ask(SYSTEM, input, SCHEMA)) };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const KINDS = ["product", "collection", "blog"] as const;

export function parseIdeas(json: unknown): Idea[] {
  const list = json && typeof json === "object" && Array.isArray((json as { ideas?: unknown }).ideas) ? (json as { ideas: unknown[] }).ideas : [];
  return list.flatMap((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const keyword = str(o.keyword, 200);
    const pageKind = KINDS.find((k) => k === o.pageKind);
    if (!keyword || !pageKind) return [];
    return [
      {
        keyword,
        productRef: pageKind === "product" && Number.isInteger(o.productRef) ? (o.productRef as number) : null,
        pageKind,
        pageName: str(o.pageName, 200),
        seoTitle: str(o.seoTitle, 120),
        metaDescription: str(o.metaDescription, 320),
        intro: str(o.intro, 1500),
        why: str(o.why, 400),
      },
    ];
  });
}

// Writes a fresh set of ideas for the shop, replacing the last one. Returns
// how many there are, or why there are none.
export async function refreshIdeas(shop: string, client: IdeasClient | null = ideasClient()) {
  if (!client) return { error: "Keyword ideas aren't switched on for this app yet." };
  const gap = await keywordGap(shop);
  if (!gap.domain) return { error: "Add your website on the Keyword gap page first." };
  const candidates = [...gap.missing, ...gap.behind]
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, KEYWORDS);
  if (!candidates.length) return { error: "There's no keyword gap yet. Refresh the Keyword gap page first." };
  const products = await db.shopProduct.findMany({ where: { shop }, orderBy: { title: "asc" }, take: PRODUCTS });

  const ideas = await client.ideas({
    website: gap.domain,
    market: gap.market,
    competitors: gap.competitors.map((c) => c.name),
    keywords: candidates.map((r) => ({
      keyword: r.keyword,
      searches: r.searchVolume,
      yourPosition: r.yourPosition,
      bestCompetitor: r.competitors[0]?.name ?? null,
    })),
    products: products.map((p, i) => ({ ref: i, title: p.title, type: p.productType })),
  });
  const volume = new Map(candidates.map((r) => [r.keyword.toLowerCase(), r.searchVolume]));
  const rows = ideas.map((i) => {
    const product = i.productRef != null ? products[i.productRef] : undefined;
    return {
      shop,
      keyword: i.keyword,
      searchVolume: volume.get(i.keyword.toLowerCase()) ?? null,
      productId: product?.productId ?? null,
      // A product page Claude pointed at a product that isn't there is shown as a new collection.
      pageKind: i.pageKind === "product" && !product ? "collection" : i.pageKind,
      pageName: product?.title ?? i.pageName,
      seoTitle: i.seoTitle,
      metaDescription: i.metaDescription,
      intro: i.intro,
      why: i.why,
    };
  });
  await db.$transaction([db.keywordIdea.deleteMany({ where: { shop } }), db.keywordIdea.createMany({ data: rows })]);
  return { count: rows.length };
}

export async function keywordIdeas(shop: string) {
  const rows = await db.keywordIdea.findMany({ where: { shop }, orderBy: [{ searchVolume: { sort: "desc", nulls: "last" } }, { keyword: "asc" }] });
  return { ideas: rows, createdAt: rows[0]?.createdAt ?? null };
}
