import db from "../../db.server";
import { claudeJson, type AskJson } from "./claude.server";
import { shopDomain } from "../traffic/gap.server";
import type { Graphql } from "../prices/prices.server";
import { imageClient, imageUrl, makeArticleImage, type MakeImage } from "./images.server";

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

export type Topic = { keyword: string; searchVolume: number | null; plannedPage: { kind: string; name: string; intro: string } };

// Writes an article for one of the shop's keyword ideas.
export async function writeArticle(shop: string, ideaId: string, ask: AskJson | null = claudeJson()) {
  if (!ask) return { error: "Blog articles aren't switched on for this app yet." };
  const idea = await db.keywordIdea.findFirst({ where: { id: ideaId, shop } });
  if (!idea) return { error: "That idea isn't there any more. Write new ideas and try again." };
  return writeTopic(shop, { keyword: idea.keyword, searchVolume: idea.searchVolume, plannedPage: { kind: idea.pageKind, name: idea.pageName, intro: idea.intro } }, ask);
}

// Writes an article for one search, from an idea or the content calendar.
// The article's picture is made straight after; the article is kept without
// one if that fails.
export async function writeTopic(
  shop: string,
  topic: Topic,
  ask: AskJson | null = claudeJson(),
  make: MakeImage | null = imageClient(),
): Promise<{ id?: string; error?: string }> {
  if (!ask) return { error: "Blog articles aren't switched on for this app yet." };
  const [website, settings, products] = await Promise.all([
    shopDomain(shop),
    db.shopSettings.findUnique({ where: { shop } }),
    db.shopProduct.findMany({ where: { shop }, orderBy: { title: "asc" }, take: PRODUCTS }),
  ]);
  const article = parseArticle(
    await ask(
      SYSTEM,
      {
        search: topic.keyword,
        searchesAMonth: topic.searchVolume,
        website,
        market: settings?.market ?? "US",
        plannedPage: topic.plannedPage,
        products: products.map((p) => ({ title: p.title, link: `/products/${p.handle}` })),
      },
      SCHEMA,
    ),
  );
  if (!article) return { error: "Couldn't write that article. Try again." };
  const row = await db.blogArticle.create({
    data: { shop, keyword: topic.keyword, searchVolume: topic.searchVolume, ...article, tags: JSON.stringify(article.tags) },
  });
  if (make) await makeArticleImage(shop, row.id, make);
  return { id: row.id };
}

const BLOGS = `#graphql
  query Blogs {
    shop { primaryDomain { url } }
    blogs(first: 10) { nodes { id handle title } }
  }`;

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

// The picture sent with an article: the one made for it, or else the photo
// of the first of the shop's products it links to.
export async function articlePicture(shop: string, a: { id: string; bodyHtml: string; imageAlt: string | null }) {
  if (a.imageAlt) {
    // A new address for each new picture, so browsers and Shopify fetch it again.
    const image = await db.articleImage.findUnique({ where: { articleId: a.id }, select: { createdAt: true } });
    if (image) return { url: `${imageUrl(a.id)}?v=${image.createdAt.getTime()}`, altText: a.imageAlt, made: true };
  }
  const handles = [...a.bodyHtml.matchAll(/href="[^"]*\/products\/([a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase());
  if (!handles.length) return null;
  const products = await db.shopProduct.findMany({ where: { shop, handle: { in: handles }, imageUrl: { not: null } } });
  const p = handles.map((h) => products.find((x) => x.handle === h)).find(Boolean);
  return p?.imageUrl ? { url: p.imageUrl, altText: p.title.slice(0, 200), made: false } : null;
}

// Sends an article to the shop's first blog (or a new "News" blog when it
// has none), as a hidden draft or published.
export async function sendArticle(shop: string, id: string, publish: boolean, graphql: Graphql, now = new Date()) {
  const a = await db.blogArticle.findFirst({ where: { id, shop } });
  if (!a) return { error: "That article isn't there any more." };
  if (a.shopifyId) return { error: "That article is already on your blog." };
  try {
    const blogs = (await graphql(BLOGS)) as {
      data?: { shop?: { primaryDomain?: { url: string } }; blogs?: { nodes: { id: string }[] } };
      errors?: { message: string }[];
    };
    if (blogs.errors?.length) throw new Error(blogs.errors[0].message);
    const blogId = blogs.data?.blogs?.nodes[0]?.id;
    const picture = await articlePicture(shop, a);
    const res = (await graphql(CREATE, {
      article: {
        ...(blogId ? { blogId } : {}),
        title: a.title,
        body: a.bodyHtml,
        summary: a.summary,
        tags: JSON.parse(a.tags) as string[],
        author: { name: "SimilarWise" },
        isPublished: publish,
        ...(picture ? { image: { url: picture.url, altText: picture.altText } } : {}),
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
    // The store's own address in Shopify, not the website typed on the
    // Keyword gap page, which can be a different store.
    const origin = blogs.data?.shop?.primaryDomain?.url?.replace(/\/$/, "") ?? `https://${shop}`;
    await db.blogArticle.update({
      where: { id },
      data: {
        status: publish ? "published" : "draft",
        shopifyId: created.id,
        url: `${origin}/blogs/${created.blog.handle}/${created.handle}`,
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

const UPDATE = `#graphql
  mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id }
      userErrors { code field message }
    }
  }`;

export type ArticleEdit = { title: string; summary: string; bodyHtml: string; metaTitle: string; metaDescription: string; tags: string[] };

// Saves the merchant's changes, and copies them to the blog post when the
// article is already on Shopify.
export async function editArticle(shop: string, id: string, edit: ArticleEdit, graphql: Graphql) {
  const a = await db.blogArticle.findFirst({ where: { id, shop } });
  if (!a) return { error: "That article isn't there any more." };
  const title = edit.title.trim().slice(0, 200);
  const bodyHtml = cleanHtml(edit.bodyHtml.slice(0, 60_000));
  if (!title) return { error: "Give the article a title." };
  if (bodyHtml.replace(/<[^>]+>/g, "").trim().length < 50) return { error: "The article needs some writing in it." };
  await db.blogArticle.update({
    where: { id },
    data: {
      title,
      bodyHtml,
      summary: edit.summary.trim().slice(0, 500),
      metaTitle: edit.metaTitle.trim().slice(0, 120) || title.slice(0, 70),
      metaDescription: edit.metaDescription.trim().slice(0, 320),
      tags: JSON.stringify(edit.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 6)),
    },
  });
  return a.shopifyId ? updateOnShopify(shop, id, graphql) : { ok: true as const };
}

// Copies an article that's already on the blog, picture included, to Shopify.
export async function updateOnShopify(shop: string, id: string, graphql: Graphql) {
  const a = await db.blogArticle.findFirst({ where: { id, shop } });
  if (!a?.shopifyId) return { ok: true as const };
  try {
    const picture = await articlePicture(shop, a);
    const res = (await graphql(UPDATE, {
      id: a.shopifyId,
      article: {
        title: a.title,
        body: a.bodyHtml,
        summary: a.summary,
        tags: JSON.parse(a.tags) as string[],
        ...(picture ? { image: { url: picture.url, altText: picture.altText } } : {}),
        metafields: [
          { namespace: "global", key: "title_tag", type: "single_line_text_field", value: a.metaTitle },
          { namespace: "global", key: "description_tag", type: "single_line_text_field", value: a.metaDescription },
        ],
      },
    })) as { data?: { articleUpdate?: { userErrors: { message: string }[] } }; errors?: { message: string }[] };
    const problem = res.errors?.[0]?.message ?? res.data?.articleUpdate?.userErrors[0]?.message;
    if (problem) throw new Error(problem);
    await db.blogArticle.update({ where: { id }, data: { error: null } });
    return { ok: true as const };
  } catch (err) {
    const message = `Saved here, but not on your blog. ${denied(err instanceof Error ? err.message : String(err))}`.slice(0, 300);
    await db.blogArticle.update({ where: { id }, data: { error: message } });
    return { error: message };
  }
}

export async function blogArticle(shop: string, id: string) {
  const a = await db.blogArticle.findFirst({ where: { id, shop } });
  if (!a) return null;
  return { ...a, picture: await articlePicture(shop, a), tags: JSON.parse(a.tags) as string[], createdAt: a.createdAt.toISOString(), sentAt: a.sentAt?.toISOString() ?? null };
}

// The store's address now, e.g. https://gift-boxes-3000.myshopify.com until a
// domain is connected. Null when Shopify can't be asked.
export async function storeOrigin(graphql: Graphql) {
  try {
    const res = (await graphql(`#graphql
      query StoreOrigin { shop { primaryDomain { url } } }`)) as { data?: { shop?: { primaryDomain?: { url: string } } } };
    return res.data?.shop?.primaryDomain?.url?.replace(/\/$/, "") ?? null;
  } catch {
    return null;
  }
}

// Points a stored storefront link at the store's current address, so links
// saved before a domain change (or with the wrong domain) still open.
export const atOrigin = (url: string | null, origin: string | null) => (url && origin ? url.replace(/^https?:\/\/[^/]+/, origin) : url);

export async function deleteArticle(shop: string, id: string) {
  const { count } = await db.blogArticle.deleteMany({ where: { id, shop, shopifyId: null } });
  if (count) await db.articleImage.deleteMany({ where: { articleId: id, shop } });
}

export async function blogArticles(shop: string) {
  const rows = await db.blogArticle.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
  const pictures = await Promise.all(rows.map((a) => articlePicture(shop, a)));
  return rows.map((a, i) => ({
    picture: pictures[i], ...a, tags: JSON.parse(a.tags) as string[], createdAt: a.createdAt.toISOString(), sentAt: a.sentAt?.toISOString() ?? null }));
}
