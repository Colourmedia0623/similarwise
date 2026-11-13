import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { AskJson } from "../ideas/claude.server";
import { addKeyword, askListening, deleteKeyword, editTopic, listeningView, parseReads, runListening, searchTerms, startListening, syncTopics } from "./listening.server";
import { parseReddit, parseTiktok, parseWeb, parseYoutube, toDate, type Found, type ListenClient } from "./sources.server";
import { net, splitOf, themeTrends, weekStarts } from "./stats";

const SHOP = "listening.myshopify.com";
const NOW = new Date("2026-11-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000);

const found = (id: string, text: string, days = 1): Found => ({
  externalId: id,
  url: `https://www.reddit.com/r/x/${id}`,
  author: "someone",
  place: "r/x",
  title: text,
  text,
  publishedAt: daysAgo(days),
  engagement: 5,
});

describe("social listening sources", () => {
  it("reads Reddit posts", () => {
    const posts = parseReddit({
      success: true,
      posts: [
        { id: "abc", title: "Foldabox lids broke", selftext: "Twice now.", permalink: "/r/packaging/comments/abc/x/", author: "jo", subreddit: "packaging", created_utc: 1762992000, score: 12 },
        { id: "nsfw", title: "x", permalink: "/r/x/", over_18: true },
        { title: "no id" },
      ],
    });
    expect(posts).toEqual([
      { externalId: "abc", url: "https://www.reddit.com/r/packaging/comments/abc/x/", author: "jo", place: "r/packaging", title: "Foldabox lids broke", text: "Twice now.", publishedAt: new Date(1762992000 * 1000), engagement: 12 },
    ]);
    expect(() => parseReddit({ success: false, message: "Out of credits" })).toThrow(/Out of credits/);
  });

  it("reads YouTube videos and shorts, and TikTok videos", () => {
    const yt = parseYoutube({
      videos: [{ id: "v1", url: "https://www.youtube.com/watch?v=v1", title: "Unboxing", channel: { title: "Box Fan", handle: "@boxfan" }, publishedTime: "2026-11-10T00:00:00Z", viewCountInt: 900 }],
      shorts: [{ id: "s1", title: "Short" }],
    });
    expect(yt.map((v) => [v.externalId, v.url, v.place, v.engagement])).toEqual([
      ["v1", "https://www.youtube.com/watch?v=v1", "@boxfan", 900],
      ["s1", "https://www.youtube.com/watch?v=s1", null, null],
    ]);
    const tt = parseTiktok({ search_item_list: [{ aweme_info: { aweme_id: "7", desc: "love these boxes", create_time: 1762992000, author: { nickname: "Sam", unique_id: "sam" }, statistics: { play_count: 4000 } } }] });
    expect(tt[0]).toMatchObject({ externalId: "7", url: "https://www.tiktok.com/@sam/video/7", place: "@sam", text: "love these boxes", engagement: 4000 });
  });

  it("reads web mentions from DataForSEO's content search", () => {
    const web = parseWeb({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                { url: "https://blog.com/a", domain: "blog.com", content_info: { title: "Verdict", main_title: "Best gift boxes", snippet: "Foldabox is sturdy.", date_published: "2026-11-01 10:00:00 +00:00" } },
                { url: "https://empty.com", content_info: {} },
              ],
            },
          ],
        },
      ],
    });
    expect(web).toEqual([{ externalId: "https://blog.com/a#Verdict", url: "https://blog.com/a", author: null, place: "blog.com", title: "Best gift boxes", text: "Foldabox is sturdy.", publishedAt: new Date("2026-11-01T10:00:00Z"), engagement: null }]);
    expect(toDate("2026-11-01 10:00:00 +00:00")).toEqual(new Date("2026-11-01T10:00:00Z"));
  });
});

describe("social listening counts", () => {
  it("works out net sentiment and weeks", () => {
    expect(net(splitOf(["positive", "positive", "negative", "neutral", null]))).toBe(25);
    expect(net(splitOf([]))).toBeNull();
    const weeks = weekStarts(NOW, 3); // NOW is a Friday
    expect(weeks.map((w) => w.toISOString().slice(0, 10))).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
  });

  it("finds the themes rising this week", () => {
    const m = (days: number, themes: string[], sentiment = "neutral") => ({ at: daysAgo(days), themes, sentiment });
    const trends = themeTrends(
      [m(1, ["delivery"], "negative"), m(2, ["delivery"], "negative"), m(3, ["delivery"]), m(10, ["delivery"]), m(2, ["price"]), m(9, ["price"]), m(15, ["price"]), m(20, ["price"]), m(1, ["eco"]), m(2, ["eco"], "positive"), m(60, ["old"])],
      NOW,
    );
    expect(trends.map((t) => [t.theme, t.week, t.rising])).toEqual([
      ["delivery", 3, true],
      ["eco", 2, true],
      ["price", 1, false],
    ]);
    expect(trends[0]).toMatchObject({ before: 0.3, negative: 2, neutral: 1 });
    expect(themeTrends([m(1, ["a"]), m(1, ["a"]), m(1, ["a"]), m(8, ["a"])], NOW)[0]).toMatchObject({ week: 3, before: 0.3, rising: true });
  });

  it("keeps Claude's reads in range", () => {
    const reads = parseReads({ mentions: [{ i: 0, relevant: false, sentiment: "odd", themes: [" Price ", 3], summary: "x" }, { i: 9, relevant: true }] }, 2);
    expect([...reads]).toEqual([[0, { relevant: false, sentiment: "neutral", themes: ["price"], summary: "x" }]]);
  });
});

describe("social listening", () => {
  beforeEach(async () => {
    await db.listenMention.deleteMany({ where: { shop: SHOP } });
    await db.listenTopic.deleteMany({ where: { shop: SHOP } });
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("picks the words to listen for", () => {
    expect(searchTerms("Gift Boxes 3000", "giftboxes3000.co.uk")).toEqual(["Gift Boxes 3000", "giftboxes3000", "giftboxes3000.co.uk"]);
    expect(searchTerms(null, "foldabox.co.uk")).toEqual(["foldabox", "foldabox.co.uk"]);
  });

  it("follows the shop's name and competitors, and the merchant's keywords", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.co.uk", aiBrand: "Mine Boxes" } });
    const c = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://www.rival.com" } });
    await syncTopics(SHOP);
    await syncTopics(SHOP);
    let topics = await db.listenTopic.findMany({ where: { shop: SHOP }, orderBy: { kind: "asc" } });
    expect(topics.map((t) => [t.kind, t.name, JSON.parse(t.terms)])).toEqual([
      ["brand", "Mine Boxes", ["Mine Boxes", "mine", "mine.co.uk"]],
      ["competitor", "Rival", ["Rival", "rival.com"]],
    ]);
    expect(await addKeyword(SHOP, "eco packaging, compostable boxes")).toEqual({ ok: true });
    expect(await addKeyword(SHOP, "Eco Packaging")).toEqual({ error: "You're already listening for “eco packaging”." });
    expect(await addKeyword(SHOP, "  ")).toEqual({ error: "Type a word or phrase to listen for." });

    await db.competitor.delete({ where: { id: c.id } });
    await syncTopics(SHOP);
    topics = await db.listenTopic.findMany({ where: { shop: SHOP } });
    expect(topics.map((t) => t.kind).sort()).toEqual(["brand", "keyword"]);
    const kw = topics.find((t) => t.kind === "keyword")!;
    expect(JSON.parse(kw.terms)).toEqual(["eco packaging", "compostable boxes"]);
    // Brand topics can't be deleted, only keywords.
    await deleteKeyword(SHOP, topics.find((t) => t.kind === "brand")!.id);
    await deleteKeyword(SHOP, kw.id);
    expect(await db.listenTopic.count({ where: { shop: SHOP } })).toBe(1);
  });

  it("collects mentions from every source, has Claude read them, and writes insights", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.co.uk", aiBrand: "Mine" } });
    await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com" } });
    const searched: string[] = [];
    const reddit: ListenClient = {
      source: "reddit",
      search: async (term) => {
        searched.push(`reddit:${term}`);
        if (term === "Rival") return [found("r1", "Rival lost my order"), found("r2", "Rival boxes are lovely", 9), found("old", "ancient", 400)];
        if (term === "Mine") return [found("m1", "Mine shipped fast"), found("m2", "Mine the mineral, nothing to do with boxes")];
        return [];
      },
    };
    const youtube: ListenClient = {
      source: "youtube",
      search: async (term) => {
        searched.push(`youtube:${term}`);
        if (term === "rival.com") throw new Error("Scrape Creators answered 500");
        return term === "Rival" ? [found("y1", "Rival unboxing")] : [];
      },
    };
    const calls: string[] = [];
    const ask: AskJson = async (system, input) => {
      if (system.includes("You read posts")) {
        calls.push("read");
        const ms = (input as { mentions: { i: number; text: string }[] }).mentions;
        return {
          mentions: ms.map((m) => ({
            i: m.i,
            relevant: !m.text.includes("mineral"),
            sentiment: /lost/.test(m.text) ? "negative" : /fast|lovely/.test(m.text) ? "positive" : "neutral",
            themes: /lost|shipped/.test(m.text) ? ["delivery"] : ["product quality"],
            summary: `Says: ${m.text}`,
          })),
        };
      }
      calls.push("insights");
      return { headline: "Rival is losing orders.", customers: ["People like your speed."], competitors: [{ name: "Rival", takeaway: "Lost orders." }], opportunities: ["Post about delivery."], risks: [] };
    };

    expect(await runListening(SHOP, { clients: [reddit, youtube], ask, now: NOW })).toEqual({ ok: true, added: 5 });
    expect(searched.sort()).toEqual(["reddit:Mine", "reddit:Rival", "reddit:mine.co.uk", "reddit:rival.com", "youtube:Mine", "youtube:Rival", "youtube:mine.co.uk", "youtube:rival.com"]);
    expect(calls).toEqual(["read", "insights"]);

    const view = await listeningView(SHOP, {}, NOW);
    expect(view.insights?.headline).toBe("Rival is losing orders.");
    expect(view.topics.map((t) => [t.kind, t.month, t.positive, t.negative, t.net])).toEqual([
      ["brand", 1, 1, 0, 100],
      ["competitor", 3, 1, 1, 0],
    ]);
    expect(view.voice.map((v) => [v.name, v.share])).toEqual([
      ["Mine", 25],
      ["Rival", 75],
    ]);
    expect(view.themes.map((t) => [t.theme, t.week])).toEqual([
      ["delivery", 2],
      ["product quality", 1],
    ]);
    // The mineral post isn't about the shop, so it's hidden.
    expect(view.feed.map((f) => f.title)).not.toContain("Mine the mineral, nothing to do with boxes");
    expect(view.feed[0]).toMatchObject({ sentiment: expect.any(String), summary: expect.stringMatching(/^Says:/) });
    const negative = await listeningView(SHOP, { sentiment: "negative" }, NOW);
    expect(negative.feed.map((f) => f.title)).toEqual(["Rival lost my order"]);

    // A second check keeps what it already has, and doesn't rewrite the insights with nothing new.
    calls.length = 0;
    expect(await runListening(SHOP, { clients: [reddit], ask, now: new Date(NOW.getTime() + 3600_000) })).toEqual({ ok: true, added: 0 });
    expect(calls).toEqual([]);
    expect(await db.listenMention.count({ where: { shop: SHOP } })).toBe(5);

    // Questions are answered from the mentions, with examples.
    const answer = await askListening(SHOP, "What themes are trending this week?", {
      now: NOW,
      ask: async (_s, input) => {
        const ms = (input as { mentions: { i: number; summary: string }[] }).mentions;
        return { answer: "Delivery.", examples: [ms.findIndex((m) => m.summary.includes("lost")), 99] };
      },
    });
    expect(answer).toMatchObject({ answer: "Delivery.", examples: [{ sentiment: "negative", summary: "Says: Rival lost my order" }] });
  });

  it("starts the topic again when its words change", async () => {
    await addKeyword(SHOP, "gift boxes");
    const t = (await db.listenTopic.findFirst({ where: { shop: SHOP } }))!;
    await db.listenMention.create({ data: { shop: SHOP, topicId: t.id, source: "reddit", externalId: "x", url: "https://x", foundAt: NOW } });
    expect(await editTopic(SHOP, t.id, "gift boxes")).toEqual({ ok: true });
    expect(await db.listenMention.count({ where: { shop: SHOP } })).toBe(1);
    expect(await editTopic(SHOP, t.id, "luxury gift boxes, gift hampers")).toEqual({ ok: true });
    expect(await db.listenMention.count({ where: { shop: SHOP } })).toBe(0);
    expect((await db.listenTopic.findUnique({ where: { id: t.id } }))?.name).toBe("luxury gift boxes");
  });

  it("won't start a check too soon or with nothing to listen for", async () => {
    const client: ListenClient = { source: "reddit", search: async () => [] };
    expect(await startListening(SHOP, { clients: [], now: NOW })).toEqual({ error: "Social listening isn't switched on for this app yet." });
    expect(await startListening(SHOP, { clients: [client], now: NOW })).toEqual({ error: "Add a keyword or a competitor to listen for first." });
    await addKeyword(SHOP, "gift boxes");
    await db.shopSettings.create({ data: { shop: SHOP, listenCheckedAt: daysAgo(0.1) } });
    expect(await startListening(SHOP, { clients: [client], now: NOW })).toEqual({ error: "You checked in the last few hours. Try again later." });
  });
});
