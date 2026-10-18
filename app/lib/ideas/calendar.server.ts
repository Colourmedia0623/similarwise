import db from "../../db.server";
import { claudeJson, type AskJson } from "./claude.server";
import { keywordGap } from "../traffic/gap.server";
import { articlePicture, deleteArticle, sendArticle, writeTopic } from "./articles.server";
import { syncIfStale, type Graphql } from "../prices/prices.server";

// Content calendar: Claude plans a blog post a day from the searches in the
// shop's keyword gap, the merchant edits or deletes any of them, and the
// hourly schedule writes each one on its day and sends it to the blog.

const DAYS = 30;
const CANDIDATES = 80;
const MAX_PLANNED = 90;
const STUCK = 3600_000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["posts"],
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keyword", "title", "angle"],
        properties: { keyword: { type: "string" }, title: { type: "string" }, angle: { type: "string" } },
      },
    },
  },
};

const SYSTEM = `You plan a month of blog posts for a small Shopify store, one a day, to win Google searches its competitors rank for. You get the store's website and market, the searches with their monthly volume, the store's product titles, and the searches it already has posts for.

Pick up to the number of posts asked for. Each post targets one search from the list, copied exactly. Prefer searches a blog post can rank for (questions, guides, ideas, comparisons, "best" lists) that lead to the store's products, and the ones with the most searches. Skip competitors' brand names, searches for things the store doesn't sell, and searches it already has posts for. Never target the same search, or a near-identical one, twice.

For each post, in the market's spelling:
- keyword: the search, exactly as given.
- title: a natural headline containing the search, under 70 characters.
- angle: one sentence on what the post covers and which products it leads to.

Order them so similar topics are spread out across the month.`;

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && addDays(v, 0) === v;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type PlannedTopic = { keyword: string; title: string; angle: string };

// Only posts for searches that were offered, once each.
export function parsePlan(json: unknown, allowed: Map<string, string>): PlannedTopic[] {
  const list = json && typeof json === "object" && Array.isArray((json as { posts?: unknown }).posts) ? (json as { posts: unknown[] }).posts : [];
  const seen = new Set<string>();
  return list.flatMap((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const key = str(o.keyword, 200).toLowerCase();
    const keyword = allowed.get(key);
    const title = str(o.title, 200);
    if (!keyword || !title || seen.has(key)) return [];
    seen.add(key);
    return [{ keyword, title, angle: str(o.angle, 500) }];
  });
}

// Plans the next month of posts, starting the day after the last one
// already planned (or tomorrow).
// With `day`, plans just one post for that day.
export async function planCalendar(shop: string, ask: AskJson | null = claudeJson(), now = new Date(), day?: string) {
  if (!ask) return { error: "The content calendar isn't switched on for this app yet." };
  const gap = await keywordGap(shop);
  if (!gap.domain) return { error: "Add your website on the Keyword gap page first." };
  const [planned, articles, products] = await Promise.all([
    db.plannedPost.findMany({ where: { shop }, orderBy: { day: "asc" }, select: { keyword: true, day: true, status: true } }),
    db.blogArticle.findMany({ where: { shop }, select: { keyword: true } }),
    db.shopProduct.findMany({ where: { shop }, orderBy: { title: "asc" }, take: 300, select: { title: true } }),
  ]);
  if (day && (!isDay(day) || day < today(now))) return { error: "Pick today or a later date." };
  const upcoming = planned.filter((p) => p.status !== "done");
  const days = Math.min(day ? 1 : DAYS, MAX_PLANNED - upcoming.length);
  if (days <= 0) return { error: `There are already ${upcoming.length} posts waiting. Delete some, or let them go out first.` };
  const covered = new Set([...planned, ...articles].map((p) => p.keyword.toLowerCase()));
  const candidates = [...gap.missing, ...gap.behind]
    .filter((r) => !covered.has(r.keyword.toLowerCase()))
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, CANDIDATES);
  if (!candidates.length)
    return { error: planned.length ? "Every search in your keyword gap already has a post." : "There's no keyword gap yet. Refresh the Keyword gap page first." };

  const topics = parsePlan(
    await ask(
      SYSTEM,
      {
        website: gap.domain,
        market: gap.market,
        postsWanted: Math.min(days, candidates.length),
        searches: candidates.map((r) => ({ search: r.keyword, searchesAMonth: r.searchVolume })),
        products: products.map((p) => p.title),
        alreadyHasPostsFor: [...covered].slice(0, 200),
      },
      SCHEMA,
    ),
    new Map(candidates.map((r) => [r.keyword.toLowerCase(), r.keyword])),
  ).slice(0, days);
  if (!topics.length) return { error: "Couldn't plan any posts. Try again." };

  const volume = new Map(candidates.map((r) => [r.keyword.toLowerCase(), r.searchVolume]));
  const last = planned.reduce((d, p) => (p.day > d ? p.day : d), today(now));
  const start = day ?? addDays(last, 1);
  await db.plannedPost.createMany({
    data: topics.map((t, i) => ({ shop, day: addDays(start, i), ...t, searchVolume: volume.get(t.keyword.toLowerCase()) ?? null })),
  });
  return { count: topics.length };
}

export type PostEdit = { day: string; keyword: string; title: string; angle: string };

export async function editPost(shop: string, id: string, edit: PostEdit, now = new Date()) {
  const keyword = edit.keyword.trim().slice(0, 200);
  const title = edit.title.trim().slice(0, 200);
  if (!keyword || !title) return { error: "Give the post a search and a title." };
  if (!isDay(edit.day)) return { error: "Pick a date for the post." };
  if (edit.day < today(now)) return { error: "Pick today or a later date." };
  const { count } = await db.plannedPost.updateMany({
    where: { id, shop, status: { in: ["planned", "failed"] } },
    data: { day: edit.day, keyword, title, angle: edit.angle.trim().slice(0, 500), status: "planned", error: null },
  });
  return count ? { ok: true as const } : { error: "That post has already been written." };
}

// Deletes a planned post. One already written takes its article with it,
// off the blog too.
export async function deletePost(shop: string, id: string, graphql?: Graphql) {
  const post = await db.plannedPost.findFirst({ where: { id, shop } });
  if (!post || post.status === "writing") return post ? { error: "That post is being written. Try again in a minute." } : { ok: true as const };
  if (post.articleId) {
    const gone = await deleteArticle(shop, post.articleId, graphql);
    if ("error" in gone) return gone;
  }
  await db.plannedPost.deleteMany({ where: { id, shop } });
  return { ok: true as const };
}

// Adds a post the merchant wrote the plan for themselves.
export async function addPost(shop: string, edit: PostEdit, now = new Date()) {
  const keyword = edit.keyword.trim().slice(0, 200);
  const title = edit.title.trim().slice(0, 200);
  if (!keyword || !title) return { error: "Give the post a search and a title." };
  if (!isDay(edit.day)) return { error: "Pick a date for the post." };
  if (edit.day < today(now)) return { error: "Pick today or a later date." };
  const row = await db.plannedPost.create({ data: { shop, day: edit.day, keyword, title, angle: edit.angle.trim().slice(0, 500) } });
  return { ok: true as const, postId: row.id };
}

export async function setCalendarPublish(shop: string, publish: boolean) {
  await db.shopSettings.upsert({ where: { shop }, update: { calendarPublish: publish }, create: { shop, calendarPublish: publish } });
}

// Writes one planned post and sends it to the blog. Claims it first, so the
// schedule and a "Write now" press can't both write it.
export async function writePost(shop: string, id: string, graphql: Graphql, ask: AskJson | null = claudeJson(), now = new Date()) {
  if (!ask) return { error: "The content calendar isn't switched on for this app yet." };
  const { count } = await db.plannedPost.updateMany({
    where: { id, shop, status: { in: ["planned", "failed"] } },
    data: { status: "writing", claimedAt: now, error: null },
  });
  if (!count) return { error: "That post is already being written." };
  const post = await db.plannedPost.findUniqueOrThrow({ where: { id } });
  const fail = async (error: string) => {
    await db.plannedPost.update({ where: { id }, data: { status: "failed", error: error.slice(0, 300) } });
    return { error };
  };
  try {
    // A post written before that failed to send is sent again, not rewritten.
    let articleId = post.articleId;
    if (!articleId) {
      // Fresh product links and photos for the article.
      await syncIfStale(shop, graphql, now).catch((err) => console.error("Product sync failed", shop, err));
      const written = await writeTopic(
        shop,
        { keyword: post.keyword, searchVolume: post.searchVolume, plannedPage: { kind: "blog", name: post.title, intro: post.angle } },
        ask,
      );
      if (!written.id) return await fail(written.error ?? "Couldn't write that article.");
      articleId = written.id;
      await db.plannedPost.update({ where: { id }, data: { articleId } });
    }
    const settings = await db.shopSettings.findUnique({ where: { shop } });
    const sent = await sendArticle(shop, articleId, settings?.calendarPublish ?? true, graphql, now);
    if ("error" in sent && sent.error !== "That article is already on your blog.") return await fail(sent.error ?? "Couldn't add it to your blog.");
    await db.plannedPost.update({ where: { id }, data: { status: "done", error: null } });
    return { ok: true as const };
  } catch (err) {
    console.error("Couldn't write a planned post", shop, id, err);
    return await fail("Couldn't write that post just now. It'll be tried again.");
  }
}

const adminGraphql = async (shop: string): Promise<Graphql> => {
  const { unauthenticated } = await import("../../shopify.server");
  const { admin } = await unauthenticated.admin(shop);
  return async (query, variables) => (await admin.graphql(query, { variables })).json();
};

// The hourly run: writes the posts that are due, one per shop per run so a
// backlog after downtime goes out an hour apart. Failed posts wait for the
// merchant to try again.
export async function runCalendar({
  ask = claudeJson(),
  graphqlFor = adminGraphql,
  now = new Date(),
}: { ask?: AskJson | null; graphqlFor?: (shop: string) => Promise<Graphql>; now?: Date } = {}) {
  if (!ask) return;
  await db.plannedPost.updateMany({ where: { status: "writing", claimedAt: { lt: new Date(now.getTime() - STUCK) } }, data: { status: "planned" } });
  const due = await db.plannedPost.findMany({ where: { status: "planned", day: { lte: today(now) } }, orderBy: [{ day: "asc" }, { createdAt: "asc" }] });
  const shops = new Set<string>();
  for (const post of due) {
    if (shops.has(post.shop)) continue;
    shops.add(post.shop);
    let graphql: Graphql;
    try {
      graphql = await graphqlFor(post.shop);
    } catch (err) {
      console.error("No admin session for the calendar", post.shop, err);
      await db.plannedPost.update({ where: { id: post.id }, data: { status: "failed", error: "Couldn't reach your store. Open SimilarWise, then try again." } });
      continue;
    }
    await writePost(post.shop, post.id, graphql, ask, now);
  }
}

export async function contentCalendar(shop: string, now = new Date()) {
  const [posts, settings] = await Promise.all([
    db.plannedPost.findMany({ where: { shop }, orderBy: [{ day: "asc" }, { createdAt: "asc" }] }),
    db.shopSettings.findUnique({ where: { shop } }),
  ]);
  const articles = await db.blogArticle.findMany({
    where: { shop, id: { in: posts.flatMap((p) => (p.articleId ? [p.articleId] : [])) } },
    select: { id: true, url: true, status: true, shopifyId: true, bodyHtml: true, imageAlt: true },
  });
  const pictures = await Promise.all(articles.map((a) => articlePicture(shop, a)));
  const byId = new Map(articles.map((a, i) => [a.id, { ...a, picture: pictures[i]?.url ?? null }]));
  return {
    today: today(now),
    publish: settings?.calendarPublish ?? true,
    posts: posts.map((p) => ({
        id: p.id,
        day: p.day,
        keyword: p.keyword,
        searchVolume: p.searchVolume,
        title: p.title,
        angle: p.angle,
        status: p.status,
        error: p.error,
        url: (p.articleId && byId.get(p.articleId)?.url) || null,
        sentAs: (p.articleId && byId.get(p.articleId)?.status) || null,
        shopifyId: (p.articleId && byId.get(p.articleId)?.shopifyId) || null,
        articleId: (p.articleId && byId.has(p.articleId) && p.articleId) || null,
        picture: (p.articleId && byId.get(p.articleId)?.picture) || null,
      })),
  };
}
