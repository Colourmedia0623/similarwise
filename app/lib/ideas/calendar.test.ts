import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { addDays, addPost, contentCalendar, deletePost, editPost, parsePlan, planCalendar, runCalendar } from "./calendar.server";
import type { AskJson } from "./claude.server";
import type { Graphql } from "../prices/prices.server";

const SHOP = "calendar.myshopify.com";
const NOW = new Date("2026-10-17T09:00:00Z");
const BODY = `<p>${"Useful words. ".repeat(30)}</p>`;

async function seedGap() {
  await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com", market: "GB" } });
  const c = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com", gapDomain: "mine.com", gapAt: NOW } });
  await db.keywordGap.createMany({
    data: [
      { competitorId: c.id, keyword: "gift box ideas", searchVolume: 900, theirPosition: 3 },
      { competitorId: c.id, keyword: "how to wrap a gift box", searchVolume: 400, theirPosition: 5 },
      { competitorId: c.id, keyword: "rival discount code", searchVolume: 2000, theirPosition: 1 },
    ],
  });
}

const article: AskJson = async (_system, input) => {
  const search = (input as { search: string }).search;
  return { title: `All about ${search}`, summary: "S", bodyHtml: BODY, metaTitle: search, metaDescription: "D", tags: [] };
};

describe("content calendar", () => {
  beforeEach(async () => {
    await db.plannedPost.deleteMany({ where: { shop: SHOP } });
    await db.blogArticle.deleteMany({ where: { shop: SHOP } });
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("keeps only offered searches, once each", () => {
    const allowed = new Map([["gift box ideas", "gift box ideas"]]);
    expect(
      parsePlan({ posts: [{ keyword: "Gift Box Ideas", title: "T", angle: "A" }, { keyword: "gift box ideas", title: "Again", angle: "" }, { keyword: "made up", title: "X", angle: "" }] }, allowed),
    ).toEqual([{ keyword: "gift box ideas", title: "T", angle: "A" }]);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("plans a post a day from the keyword gap, after what's already planned", async () => {
    await seedGap();
    let offered: string[] = [];
    const ask: AskJson = async (_system, input) => {
      offered = (input as { searches: { search: string }[] }).searches.map((s) => s.search);
      return { posts: offered.filter((s) => !s.includes("rival")).map((s) => ({ keyword: s, title: `Post on ${s}`, angle: "" })) };
    };
    expect(await planCalendar(SHOP, ask, NOW)).toEqual({ count: 2 });
    const posts = await db.plannedPost.findMany({ where: { shop: SHOP }, orderBy: { day: "asc" } });
    expect(posts.map((p) => [p.day, p.keyword, p.searchVolume])).toEqual([
      ["2026-10-18", "gift box ideas", 900],
      ["2026-10-19", "how to wrap a gift box", 400],
    ]);
    // Searches with a post already aren't offered again.
    expect(await planCalendar(SHOP, ask, NOW)).toEqual({ error: "Couldn't plan any posts. Try again." });
    expect(offered).toEqual(["rival discount code"]);
  });

  it("plans one post for an empty day", async () => {
    await seedGap();
    const ask: AskJson = async (_system, input) => {
      expect((input as { postsWanted: number }).postsWanted).toBe(1);
      return { posts: [{ keyword: "gift box ideas", title: "Gift box ideas", angle: "" }, { keyword: "how to wrap a gift box", title: "Wrap", angle: "" }] };
    };
    expect(await planCalendar(SHOP, ask, NOW, "2026-10-25")).toEqual({ count: 1 });
    expect(await db.plannedPost.findMany({ where: { shop: SHOP }, select: { day: true, keyword: true } })).toEqual([{ day: "2026-10-25", keyword: "gift box ideas" }]);
    expect(await planCalendar(SHOP, ask, NOW, "2026-10-01")).toEqual({ error: "Pick today or a later date." });
  });

  it("adds a post the merchant planned", async () => {
    expect(await addPost(SHOP, { day: "2026-10-20", keyword: "  box sizes ", title: "Which box size?", angle: "" }, NOW)).toMatchObject({ ok: true });
    expect(await addPost(SHOP, { day: "2026-10-20", keyword: "", title: "No search", angle: "" }, NOW)).toEqual({ error: "Give the post a search and a title." });
    expect(await addPost(SHOP, { day: "2026-10-01", keyword: "k", title: "t", angle: "" }, NOW)).toEqual({ error: "Pick today or a later date." });
    expect((await db.plannedPost.findFirst({ where: { shop: SHOP } }))?.keyword).toBe("box sizes");
  });

  it("deletes a written post with its article, off the blog too", async () => {
    const a = await db.blogArticle.create({
      data: { shop: SHOP, keyword: "k", title: "T", summary: "S", bodyHtml: BODY, metaTitle: "M", metaDescription: "D", tags: "[]", status: "published", shopifyId: "gid://shopify/Article/9" },
    });
    const post = await db.plannedPost.create({ data: { shop: SHOP, day: "2026-10-16", keyword: "k", title: "T", status: "done", articleId: a.id } });
    const calls: unknown[] = [];
    const failing: Graphql = async () => ({ data: { articleDelete: { userErrors: [{ code: "INTERNAL", message: "Nope" }] } } });
    expect(await deletePost(SHOP, post.id, failing)).toEqual({ error: "Couldn't take it off your blog: Nope" });
    expect(await db.blogArticle.count({ where: { shop: SHOP } })).toBe(1);
    const ok: Graphql = async (_q, v) => {
      calls.push(v);
      return { data: { articleDelete: { deletedArticleId: "gid://shopify/Article/9", userErrors: [] } } };
    };
    expect(await deletePost(SHOP, post.id, ok)).toEqual({ ok: true });
    expect(calls).toEqual([{ id: "gid://shopify/Article/9" }]);
    expect(await db.blogArticle.count({ where: { shop: SHOP } })).toBe(0);
    expect(await db.plannedPost.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("lets the merchant move a post, but not into the past", async () => {
    const p = await db.plannedPost.create({ data: { shop: SHOP, day: "2026-10-20", keyword: "k", title: "T" } });
    expect(await editPost(SHOP, p.id, { day: "2026-10-01", keyword: "k", title: "T", angle: "" }, NOW)).toEqual({ error: "Pick today or a later date." });
    expect(await editPost(SHOP, p.id, { day: "2026-10-25", keyword: " new search ", title: "New", angle: "Covers it" }, NOW)).toEqual({ ok: true });
    expect(await db.plannedPost.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ day: "2026-10-25", keyword: "new search", title: "New" });
  });

  it("writes and publishes the posts that are due, one per shop per run", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com", calendarPublish: false } });
    await db.plannedPost.createMany({
      data: [
        { shop: SHOP, day: "2026-10-16", keyword: "missed day", title: "Missed" },
        { shop: SHOP, day: "2026-10-17", keyword: "due today", title: "Today" },
        { shop: SHOP, day: "2026-10-18", keyword: "tomorrow", title: "Tomorrow" },
      ],
    });
    const sent: Record<string, unknown>[] = [];
    const graphql: Graphql = async (query, variables) => {
      if (query.includes("products(")) return { data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
      if (query.includes("blogs(")) return { data: { blogs: { nodes: [{ id: "gid://shopify/Blog/1" }] } } };
      sent.push((variables as { article: Record<string, unknown> }).article);
      return { data: { articleCreate: { article: { id: `gid://shopify/Article/${sent.length}`, handle: `post-${sent.length}`, blog: { handle: "news" } }, userErrors: [] } } };
    };
    await runCalendar({ ask: article, graphqlFor: async () => graphql, now: NOW });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "All about missed day", isPublished: false, blogId: "gid://shopify/Blog/1" });

    await runCalendar({ ask: article, graphqlFor: async () => graphql, now: NOW });
    await runCalendar({ ask: article, graphqlFor: async () => graphql, now: NOW });
    expect(sent.map((a) => a.title)).toEqual(["All about missed day", "All about due today"]);

    const cal = await contentCalendar(SHOP, NOW);
    expect(cal.posts.map((p) => [p.keyword, p.status, p.sentAs])).toEqual([
      ["missed day", "done", "draft"],
      ["due today", "done", "draft"],
      ["tomorrow", "planned", null],
    ]);
    expect(cal.posts[0].url).toBe("https://calendar.myshopify.com/blogs/news/post-1");
  });

  it("marks a post that couldn't go out, and sends the written article on retry", async () => {
    const p = await db.plannedPost.create({ data: { shop: SHOP, day: "2026-10-17", keyword: "k", title: "T" } });
    let allow = false;
    const graphql: Graphql = async (query) => {
      if (!allow) return { errors: [{ message: "Access denied for blogs field." }] };
      if (query.includes("blogs(")) return { data: { blogs: { nodes: [{ id: "gid://shopify/Blog/1" }] } } };
      return { data: { articleCreate: { article: { id: "gid://shopify/Article/1", handle: "t", blog: { handle: "news" } }, userErrors: [] } } };
    };
    let writes = 0;
    const counting: AskJson = async (s, i, sc) => {
      writes++;
      return article(s, i, sc);
    };
    await runCalendar({ ask: counting, graphqlFor: async () => graphql, now: NOW });
    expect(await db.plannedPost.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "failed", error: expect.stringMatching(/needs permission/) });
    // Failed posts wait for the merchant rather than retrying every hour.
    await runCalendar({ ask: counting, graphqlFor: async () => graphql, now: NOW });
    expect(writes).toBe(1);

    allow = true;
    const { writePost } = await import("./calendar.server");
    expect(await writePost(SHOP, p.id, graphql, counting, NOW)).toEqual({ ok: true });
    expect(writes).toBe(1);
    expect(await db.blogArticle.count({ where: { shop: SHOP } })).toBe(1);
  });
});
