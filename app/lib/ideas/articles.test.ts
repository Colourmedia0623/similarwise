import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { atOrigin, cleanHtml, parseArticle, sendArticle, writeArticle } from "./articles.server";
import type { Graphql } from "../prices/prices.server";

const SHOP = "articles.myshopify.com";
const BODY = `<h2 class="x" onclick="evil()">Pick the right box</h2><p>${"Useful words. ".repeat(30)}<a href="/products/gift-box" target="_blank">our gift box</a> and <a href="javascript:alert(1)">bad</a></p><script>alert(1)</script><img src="x.png"><div><p>Done.</p></div>`;

describe("blog articles", () => {
  beforeEach(async () => {
    await db.blogArticle.deleteMany({ where: { shop: SHOP } });
    await db.keywordIdea.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
    await db.shopProduct.deleteMany({ where: { shop: SHOP } });
  });

  it("keeps only plain article HTML and safe links", () => {
    expect(cleanHtml(BODY)).toBe(
      `<h2>Pick the right box</h2><p>${"Useful words. ".repeat(30)}<a href="/products/gift-box">our gift box</a> and <a>bad</a></p><p>Done.</p>`,
    );
    expect(cleanHtml('<a href="//evil.com">x</a><a href="https://ok.com/a">y</a>')).toBe('<a>x</a><a href="https://ok.com/a">y</a>');
    expect(parseArticle({ title: "Hi", bodyHtml: "<p>too short</p>" })).toBeNull();
    expect(atOrigin("https://giftboxes.co.uk/blogs/news/a", "https://gift-boxes-3000.myshopify.com")).toBe("https://gift-boxes-3000.myshopify.com/blogs/news/a");
    expect(atOrigin("https://giftboxes.co.uk/blogs/news/a", null)).toBe("https://giftboxes.co.uk/blogs/news/a");
  });

  it("writes an article from an idea, then adds it to the shop's blog", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com", market: "GB" } });
    await db.shopProduct.create({ data: { shop: SHOP, productId: "gid://shopify/Product/1", handle: "gift-box", title: "Gift box", priceCents: 500, currency: "GBP" } });
    const idea = await db.keywordIdea.create({
      data: { shop: SHOP, keyword: "gift box ideas", searchVolume: 900, pageKind: "blog", pageName: "Gift box ideas", seoTitle: "t", metaDescription: "m", intro: "i", why: "w" },
    });
    let input: Record<string, unknown> = {};
    const written = await writeArticle(SHOP, idea.id, async (_system, given) => {
      input = given as Record<string, unknown>;
      return { title: "Gift box ideas for every occasion", summary: "S", bodyHtml: BODY, metaTitle: "Gift box ideas", metaDescription: "D", tags: ["Gifts", ""] };
    });
    expect(input).toMatchObject({ search: "gift box ideas", website: "mine.com", market: "GB", products: [{ title: "Gift box", link: "/products/gift-box" }] });
    const id = written.id;
    if (!id) throw new Error("not written");

    const calls: { query: string; variables?: Record<string, unknown> }[] = [];
    const graphql: Graphql = async (query, variables) => {
      calls.push({ query, variables });
      if (query.includes("blogs(")) return { data: { shop: { primaryDomain: { url: "https://www.mine.com/" } }, blogs: { nodes: [] } } };
      return { data: { articleCreate: { article: { id: "gid://shopify/Article/9", handle: "gift-box-ideas", blog: { handle: "news" } }, userErrors: [] } } };
    };
    expect(await sendArticle(SHOP, id, false, graphql)).toEqual({ ok: true });
    const sent = calls[1].variables as { article: Record<string, unknown>; blog?: unknown };
    expect(sent.blog).toEqual({ title: "News" });
    expect(sent.article).toMatchObject({ title: "Gift box ideas for every occasion", isPublished: false, tags: ["Gifts"] });
    const row = await db.blogArticle.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "draft", url: "https://www.mine.com/blogs/news/gift-box-ideas", error: null });
    expect(await sendArticle(SHOP, id, true, graphql)).toEqual({ error: "That article is already on your blog." });
  });

  it("explains a missing permission", async () => {
    const a = await db.blogArticle.create({ data: { shop: SHOP, keyword: "k", title: "T", summary: "", bodyHtml: "<p>x</p>", metaTitle: "T", metaDescription: "" } });
    const res = await sendArticle(SHOP, a.id, true, async () => ({ errors: [{ message: "Access denied for blogs field. Required access: `read_content` access scope." }] }));
    expect(res).toEqual({ error: expect.stringMatching(/needs permission to add blog posts/) });
  });
});
