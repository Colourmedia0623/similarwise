import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { writeTopic, sendArticle } from "./articles.server";
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
