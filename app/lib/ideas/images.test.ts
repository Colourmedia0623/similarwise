import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { articlePicture, writeTopic, sendArticle } from "./articles.server";
import { imagePrompt, makeArticleImage } from "./images.server";
import type { Graphql } from "../prices/prices.server";

const SHOP = "images.myshopify.com";
const BODY = `<p>${"Useful words. ".repeat(30)}</p>`;
const ask = async () => ({ title: "Gift box ideas", summary: "Ideas for every occasion.", bodyHtml: BODY, metaTitle: "t", metaDescription: "d", tags: [] });
const topic = { keyword: "gift box ideas", searchVolume: 900, plannedPage: { kind: "blog", name: "Gift box ideas", intro: "" } };

describe("article images", () => {
  beforeEach(async () => {
    await db.articleImage.deleteMany({ where: { shop: SHOP } });
    await db.blogArticle.deleteMany({ where: { shop: SHOP } });
    await db.shopProduct.deleteMany({ where: { shop: SHOP } });
  });

  it("uses the photo of a product the article links to when no picture was made", async () => {
    await db.shopProduct.createMany({
      data: [
        { shop: SHOP, productId: "gid://shopify/Product/1", handle: "plain-box", title: "Plain box", priceCents: 100, currency: "GBP" },
        { shop: SHOP, productId: "gid://shopify/Product/2", handle: "red-box", title: "Red box", priceCents: 100, currency: "GBP", imageUrl: "https://cdn.shopify.com/red.jpg" },
      ],
    });
    const bodyHtml = '<p><a href="/products/plain-box">a</a> <a href="https://x.com/products/red-box">b</a></p>';
    expect(await articlePicture(SHOP, { id: "x", bodyHtml, imageAlt: null })).toEqual({ url: "https://cdn.shopify.com/red.jpg", altText: "Red box", made: false });
    expect(await articlePicture(SHOP, { id: "x", bodyHtml: "<p>none</p>", imageAlt: null })).toBeNull();
    expect(await articlePicture(SHOP, { id: "x", bodyHtml, imageAlt: "Made" })).toMatchObject({ altText: "Made", made: true });
  });

  it("makes a picture with each article and sends it as the post's image", async () => {
    const prompts: string[] = [];
    const { id } = await writeTopic(SHOP, topic, ask, async (prompt) => {
      prompts.push(prompt);
      return new Uint8Array([1, 2, 3]);
    });
    if (!id) throw new Error("not written");
    expect(prompts[0]).toContain('"Gift box ideas"');
    expect(prompts[0]).toMatch(/No text/);
    expect([...(await db.articleImage.findUniqueOrThrow({ where: { articleId: id } })).data]).toEqual([1, 2, 3]);

    let sent: Record<string, unknown> = {};
    const graphql: Graphql = async (query, variables) => {
      if (query.includes("blogs(")) return { data: { blogs: { nodes: [{ id: "gid://shopify/Blog/1" }] } } };
      sent = (variables as { article: Record<string, unknown> }).article;
      return { data: { articleCreate: { article: { id: "gid://shopify/Article/1", handle: "a", blog: { handle: "news" } }, userErrors: [] } } };
    };
    await sendArticle(SHOP, id, true, graphql);
    expect(sent.image).toEqual({ url: expect.stringMatching(new RegExp(`/images/${id}\\.jpg$`)), altText: "Gift box ideas" });
  });

  it("keeps the article when the picture fails, and sends it without one", async () => {
    const { id } = await writeTopic(SHOP, topic, ask, async () => {
      throw new Error("content policy");
    });
    if (!id) throw new Error("not written");
    expect(await db.blogArticle.findUniqueOrThrow({ where: { id } })).toMatchObject({ imageAlt: null, imageError: expect.stringMatching(/Couldn't make a picture/) });
    expect(await makeArticleImage(SHOP, id, async () => new Uint8Array([9]))).toEqual({ ok: true });
    expect(await db.blogArticle.findUniqueOrThrow({ where: { id } })).toMatchObject({ imageAlt: "Gift box ideas", imageError: null });
    expect(imagePrompt({ title: "T", keyword: "k", summary: "" })).not.toContain("The post:");
  });
});
