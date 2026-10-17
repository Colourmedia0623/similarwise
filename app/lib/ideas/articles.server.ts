import db from "../../db.server";
import { claudeJson, type AskJson } from "./claude.server";
import { shopDomain } from "../traffic/gap.server";
import type { Graphql } from "../prices/prices.server";

// Blog articles: Claude writes a full post for one of the shop's keyword
// ideas, linking to the shop's own products, and the merchant sends it to
// their Shopify blog as a draft or published straight away.

const PRODUCTS = 150;

export type Article = { title: string; summary: string; bodyHtml: string; metaTitle: string; metaDescription: string; tags: string[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "bodyHtml", "metaTitle", "metaDescription", "tags"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    bodyHtml: { type: "string" },
    metaTitle: { type: "string" },
    metaDescription: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM = `You write blog articles for small Shopify stores that help them rank on Google for one search. You get the search, how many people make it each month, the store's website and market, the page idea already planned for it, and the store's products with their links.

Write one genuinely useful article for a shopper making that search, in the market's spelling:
- title: a natural headline that contains the search, under 70 characters.
- bodyHtml: 700 to 1,100 words of HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em> and <a href>. No <h1> (the title is shown above it), no images, no inline styles. Open with a short paragraph that answers the search directly. Use the search and close variations naturally in a few headings and paragraphs, never stuffed. Link to 2 to 4 of the store's products where they genuinely fit, using exactly the links given. End with a short paragraph pointing the reader to the store.
- summary: one or two sentences for the blog listing.
- metaTitle: under 60 characters, the search near the start.
- metaDescription: under 155 characters, says what the reader learns, no hype.
- tags: 2 to 4 short topic tags.

Only state facts that hold for any store selling these products; don't invent prices, delivery times, guarantees, awards or statistics.`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Only the tags the prompt allows, without attributes, and links only to
// web or site-relative addresses.
export function cleanHtml(html: string): string {
  const allowed = new Set(["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "a", "br", "blockquote"]);
  return html
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, name: string, attrs: string) => {
      const n = name.toLowerCase();
      if (!allowed.has(n)) return "";
      if (tag.startsWith("</")) return `</${n}>`;
      if (n === "a") {
        const href = attrs.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
        return /^(https?:\/\/|\/)[^\s"'<>]*$/i.test(href) && !/^\/\//.test(href) ? `<a href="${href}">` : "<a>";
      }
      return `<${n}>`;
    })
    .trim();
}

export function parseArticle(json: unknown): Article | null {
  const o = (json ?? {}) as Record<string, unknown>;
  const title = str(o.title, 200);
  const bodyHtml = cleanHtml(str(o.bodyHtml, 40_000));
  if (!title || bodyHtml.length < 200) return null;
  return {
    title,
    summary: str(o.summary, 500),
    bodyHtml,
    metaTitle: str(o.metaTitle, 120) || title.slice(0, 70),
    metaDescription: str(o.metaDescription, 320),
    tags: (Array.isArray(o.tags) ? o.tags : []).map((t) => str(t, 40)).filter(Boolean).slice(0, 6),
  };
}

// Writes an article for one of the shop's keyword ideas.
export async function writeArticle(shop: string, ideaId: string, ask: AskJson | null = claudeJson()) {
  if (!ask) return { error: "Blog articles aren't switched on for this app yet." };
  const idea = await db.keywordIdea.findFirst({ where: { id: ideaId, shop } });
  if (!idea) return { error: "That idea isn't there any more. Write new ideas and try again." };
  const [website, settings, products] = await Promise.all([
    shopDomain(shop),
    db.shopSettings.findUnique({ where: { shop } }),
    db.shopProduct.findMany({ where: { shop }, orderBy: { title: "asc" }, take: PRODUCTS }),
  ]);
  const article = parseArticle(
    await ask(
      SYSTEM,
      {
        search: idea.keyword,
        searchesAMonth: idea.searchVolume,
        website,
        market: settings?.market ?? "US",
        plannedPage: { kind: idea.pageKind, name: idea.pageName, intro: idea.intro },
        products: products.map((p) => ({ title: p.title, link: `/products/${p.handle}` })),
      },
      SCHEMA,
    ),
  );
  if (!article) return { error: "Couldn't write that article. Try again." };
  const row = await db.blogArticle.create({
    data: { shop, keyword: idea.keyword, searchVolume: idea.searchVolume, ...article, tags: JSON.stringify(article.tags) },
  });
  return { id: row.id };
}

const BLOGS = `#graphql
  query Blogs { blogs(first: 10) { nodes { id handle title } } }`;

const CREATE = `#graphql
  mutation CreateArticle($article: ArticleCreateInput!, $blog: ArticleBlogInput) {
    articleCreate(article: $article, blog: $blog) {
      article { id handle isPublished blog { handle } }
      userErrors { code field message }
    }
  }`;

type CreateResult = {
  data?: { articleCreate?: { article: { id: string; handle: string; blog: { handle: string } } | null; userErrors: { message: string }[] } };
  errors?: { message: string }[];
};

const denied = (message: string) =>
  /access denied|write_content|scope/i.test(message)
    ? "SimilarWise needs permission to add blog posts. Close and reopen the app to approve it, then try again."
    : `Shopify didn't accept the article: ${message}`;

// Sends an article to the shop's first blog (or a new "News" blog when it
// has none), as a hidden draft or published.
export async function sendArticle(shop: string, id: string, publish: boolean, graphql: Graphql, now = new Date()) {
  const a = await db.blogArticle.findFirst({ where: { id, shop } });
  if (!a) return { error: "That article isn't there any more." };
  if (a.shopifyId) return { error: "That article is already on your blog." };
  try {
    const blogs = (await graphql(BLOGS)) as { data?: { blogs?: { nodes: { id: string }[] } }; errors?: { message: string }[] };
    if (blogs.errors?.length) throw new Error(blogs.errors[0].message);
    const blogId = blogs.data?.blogs?.nodes[0]?.id;
    const res = (await graphql(CREATE, {
      article: {
        ...(blogId ? { blogId } : {}),
        title: a.title,
        body: a.bodyHtml,
        summary: a.summary,
        tags: JSON.parse(a.tags) as string[],
        author: { name: "SimilarWise" },
        isPublished: publish,
        ...(publish ? { publishDate: now.toISOString() } : {}),
        metafields: [
          { namespace: "global", key: "title_tag", type: "single_line_text_field", value: a.metaTitle },
          { namespace: "global", key: "description_tag", type: "single_line_text_field", value: a.metaDescription },
        ],
      },
      ...(blogId ? {} : { blog: { title: "News" } }),
    })) as CreateResult;
    const problem = res.errors?.[0]?.message ?? res.data?.articleCreate?.userErrors[0]?.message;
    const created = res.data?.articleCreate?.article;
    if (problem || !created) throw new Error(problem ?? "no article came back");
    const domain = await shopDomain(shop);
    await db.blogArticle.update({
      where: { id },
      data: {
        status: publish ? "published" : "draft",
        shopifyId: created.id,
        url: domain ? `https://${domain}/blogs/${created.blog.handle}/${created.handle}` : null,
        error: null,
        sentAt: now,
      },
    });
    return { ok: true as const };
  } catch (err) {
    const message = denied(err instanceof Error ? err.message : String(err)).slice(0, 300);
    await db.blogArticle.update({ where: { id }, data: { error: message } });
    return { error: message };
  }
}

export async function deleteArticle(shop: string, id: string) {
  await db.blogArticle.deleteMany({ where: { id, shop, shopifyId: null } });
}

export async function blogArticles(shop: string) {
  const rows = await db.blogArticle.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
  return rows.map((a) => ({ ...a, tags: JSON.parse(a.tags) as string[], createdAt: a.createdAt.toISOString(), sentAt: a.sentAt?.toISOString() ?? null }));
}
