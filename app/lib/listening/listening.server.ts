import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import { brandTerms } from "../ai/mentions.server";
import { shopDomain } from "../traffic/gap.server";
import { shopMarket } from "../traffic/refresh.server";
import { brandTerm } from "../traffic/dataforseo.server";
import { hostOf } from "../tracker/url";
import { listenClients, SOURCES, type Found, type ListenClient, type Source } from "./sources.server";
import { addDays, net, splitOf, themeTrends, weekStarts, type Sentiment } from "./stats";

// Social listening: what people say on Reddit, YouTube, TikTok and the wider
// web about the shop, its competitors and the topics it cares about. Mentions
// are collected every few days, Claude reads each one for its sentiment and
// themes, and then writes what the shop should take from them.

const DAY = 86400_000;
const EVERY = 3 * DAY; // Automatic checks
const MIN_GAP = 6 * 3600_000; // Between checks the merchant starts
const STUCK = 3600_000;
const KEEP = 180 * DAY;
export const MAX_KEYWORDS = 10;
const TERMS_PER_TOPIC = 2;
const READ_BATCH = 30;
const AT_ONCE = 4;

export type Kind = "brand" | "competitor" | "keyword";
export type Insights = {
  headline: string;
  customers: string[];
  competitors: { name: string; takeaway: string }[];
  opportunities: string[];
  risks: string[];
};

const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

const cleanTerm = (t: string) => t.trim().replace(/\s+/g, " ").slice(0, 80);
export function cleanTerms(list: string[]) {
  const seen = new Set<string>();
  return list
    .map(cleanTerm)
    .filter((t) => t.length >= 2 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 5);
}

// The words to search for a shop or competitor: its name, then the name in
// its domain, then the domain itself. Searching "foldabox.co.uk" finds links
// to the site; the names find people talking about it.
export function searchTerms(name: string | null, domain: string | null) {
  const terms = brandTerms(name, domain);
  const term = domain ? brandTerm(domain) : null;
  const named = name?.trim() ? [name.trim()] : [];
  return cleanTerms([...named, ...(term ? [term] : []), ...terms.filter((t) => t.includes("."))]);
}

// Keeps the brand and competitor topics in step with the shop's name and
// competitor list. The merchant's own changes to their words are kept.
export async function syncTopics(shop: string) {
  const [settings, domain, competitors, topics] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopDomain(shop),
    db.competitor.findMany({ where: { shop }, select: { id: true, name: true, url: true }, orderBy: { createdAt: "asc" } }),
    db.listenTopic.findMany({ where: { shop } }),
  ]);
  const brandName = settings?.aiBrand || null;
  const brand = topics.find((t) => t.kind === "brand");
  const brandWords = searchTerms(brandName, domain);
  if (!brand && brandWords.length) {
    await db.listenTopic.create({ data: { shop, kind: "brand", name: brandName || domain || "Your shop", terms: JSON.stringify(brandWords) } });
  } else if (brand && parse<string[]>(brand.terms, []).length === 0 && brandWords.length) {
    await db.listenTopic.update({ where: { id: brand.id }, data: { name: brandName || domain || brand.name, terms: JSON.stringify(brandWords) } });
  }
  const ids = new Set(competitors.map((c) => c.id));
  const gone = topics.filter((t) => t.kind === "competitor" && (!t.competitorId || !ids.has(t.competitorId))).map((t) => t.id);
  if (gone.length) {
    await db.listenMention.deleteMany({ where: { shop, topicId: { in: gone } } });
    await db.listenTopic.deleteMany({ where: { id: { in: gone } } });
  }
  const have = new Set(topics.map((t) => t.competitorId).filter(Boolean));
  const fresh = competitors.filter((c) => !have.has(c.id));
  if (fresh.length) {
    await db.listenTopic.createMany({
      data: fresh.map((c) => ({
        shop,
        kind: "competitor",
        name: c.name,
        competitorId: c.id,
        terms: JSON.stringify(searchTerms(c.name, hostOf(c.url).replace(/^www\./, ""))),
      })),
    });
  }
}

export async function addKeyword(shop: string, text: string) {
  const terms = cleanTerms(text.split(","));
  if (!terms.length) return { error: "Type a word or phrase to listen for." };
  if ((await db.listenTopic.count({ where: { shop, kind: "keyword" } })) >= MAX_KEYWORDS) return { error: `You can listen for up to ${MAX_KEYWORDS} keywords. Delete one first.` };
  const existing = await db.listenTopic.findMany({ where: { shop, kind: "keyword" }, select: { name: true } });
  const same = existing.find((e) => e.name.toLowerCase() === terms[0].toLowerCase());
  if (same) return { error: `You're already listening for “${same.name}”.` };
  await db.listenTopic.create({ data: { shop, kind: "keyword", name: terms[0], terms: JSON.stringify(terms) } });
  return { ok: true as const };
}

// New words start the topic's mentions again, since the old ones were found with other words.
export async function editTopic(shop: string, id: string, text: string) {
  const terms = cleanTerms(text.split(","));
  if (!terms.length) return { error: "Keep at least one word to listen for." };
  const topic = await db.listenTopic.findFirst({ where: { id, shop } });
  if (!topic) return { error: "That topic isn't there any more." };
  if (JSON.stringify(parse<string[]>(topic.terms, [])) === JSON.stringify(terms)) return { ok: true as const };
  await db.$transaction([
    db.listenTopic.update({ where: { id }, data: { terms: JSON.stringify(terms), ...(topic.kind === "keyword" ? { name: terms[0] } : {}) } }),
    db.listenMention.deleteMany({ where: { topicId: id } }),
  ]);
  return { ok: true as const };
}

export async function deleteKeyword(shop: string, id: string) {
  const { count } = await db.listenTopic.deleteMany({ where: { id, shop, kind: "keyword" } });
  if (count) await db.listenMention.deleteMany({ where: { shop, topicId: id } });
}

const SUGGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keywords"],
  properties: { keywords: { type: "array", items: { type: "string" } } },
};

const SUGGEST_SYSTEM = `You pick the words a small online shop should listen for on Reddit, YouTube, TikTok and the web, so it hears what shoppers say about what it sells. You get the shop's market, website, product titles, and the Google searches it competes for.

Suggest the number of keywords asked for: short phrases of one to three words that people really use when they talk about this kind of product online (the product type, the problem it solves, the occasion, a material or value people care about, such as "biodegradable packaging" or "gift for new dads"). Never a brand name. Not so broad that every post matches ("gifts"), not so narrow nobody says it. No two alike, and none already listened for.`;

// Claude suggests keywords from the shop's products and keyword gap, for the merchant to pick from.
export async function suggestKeywords(shop: string, ask: AskJson | null = claudeJson()) {
  if (!ask) return { error: "Keyword suggestions aren't switched on for this app yet." };
  const [domain, market, products, gap, topics] = await Promise.all([
    shopDomain(shop),
    shopMarket(shop),
    db.shopProduct.findMany({ where: { shop }, orderBy: { title: "asc" }, take: 150, select: { title: true } }),
    db.keywordGap.findMany({ where: { competitor: { shop } }, orderBy: { searchVolume: "desc" }, take: 40, select: { keyword: true }, distinct: ["keyword"] }),
    db.listenTopic.findMany({ where: { shop, kind: "keyword" }, select: { name: true } }),
  ]);
  if (!products.length && !gap.length) return { error: "Add some products to your store first, or refresh the Keyword gap page." };
  const out = (await ask(
    SUGGEST_SYSTEM,
    { market: market.name, website: domain, keywordsWanted: 8, products: products.map((p) => p.title), searches: gap.map((g) => g.keyword), alreadyListening: topics.map((t) => t.name) },
    SUGGEST_SCHEMA,
  )) as { keywords?: unknown } | null;
  const seen = new Set(topics.map((t) => t.name.toLowerCase()));
  const keywords = (Array.isArray(out?.keywords) ? out.keywords : [])
    .flatMap((k) => (typeof k === "string" && cleanTerm(k).length >= 2 ? [cleanTerm(k)] : []))
    .filter((k) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
    .slice(0, 8);
  if (!keywords.length) return { error: "Couldn't think of any keywords. Try again." };
  return { keywords };
}

// ---- Reading mentions ----

const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mentions"],
  properties: {
    mentions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "relevant", "sentiment", "themes", "summary"],
        properties: {
          i: { type: "integer" },
          relevant: { type: "boolean" },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          themes: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      },
    },
  },
};

const READ_SYSTEM = `You read posts, comments, videos and web pages found by searching for a brand, a competitor or a keyword, for a small online shop's social listening. For each one, numbered i, decide:

- relevant: false when it isn't about the topic at all (the same word meaning something else, a person with the same name, spam, a page that just lists links). True otherwise.
- sentiment: how the writer feels about the topic: positive, neutral or negative. Questions, news and plain descriptions are neutral. Judge the feeling toward the topic, not the post's mood in general.
- themes: one to three short lowercase themes it's about, two or three words each, such as "delivery times", "price", "product quality", "customer service", "sizing", "sustainability", "gift ideas". Reuse a theme from knownThemes whenever one fits, so the same thing is always called the same.
- summary: one plain sentence, under 25 words, saying what the writer says.

Return one entry for every mention you're given.`;

type Read = { relevant: boolean; sentiment: Sentiment; themes: string[]; summary: string };

export function parseReads(out: unknown, count: number): Map<number, Read> {
  const list = (out as { mentions?: unknown } | null)?.mentions;
  const reads = new Map<number, Read>();
  for (const r of Array.isArray(list) ? list : []) {
    const m = r as Record<string, unknown>;
    const i = typeof m.i === "number" ? m.i : -1;
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    const sentiment = m.sentiment === "positive" || m.sentiment === "negative" ? m.sentiment : "neutral";
    const themes = (Array.isArray(m.themes) ? m.themes : [])
      .flatMap((t) => (typeof t === "string" && t.trim() ? [t.trim().toLowerCase().slice(0, 40)] : []))
      .slice(0, 3);
    reads.set(i, { relevant: m.relevant !== false, sentiment, themes, summary: typeof m.summary === "string" ? m.summary.trim().slice(0, 300) : "" });
  }
  return reads;
}

async function readMentions(shop: string, ask: AskJson) {
  const topics = new Map((await db.listenTopic.findMany({ where: { shop } })).map((t) => [t.id, t]));
  const known = await db.listenMention.findMany({ where: { shop, read: true, relevant: true }, select: { themes: true }, orderBy: { foundAt: "desc" }, take: 400 });
  const themeCount = new Map<string, number>();
  for (const k of known) for (const t of parse<string[]>(k.themes, [])) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
  const knownThemes = [...themeCount].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([t]) => t);
  for (;;) {
    const batch = await db.listenMention.findMany({ where: { shop, read: false }, orderBy: { foundAt: "asc" }, take: READ_BATCH });
    if (!batch.length) return;
    const out = await ask(READ_SYSTEM, {
      knownThemes,
      mentions: batch.map((m, i) => {
        const t = topics.get(m.topicId);
        return { i, topic: t?.name, topicType: t?.kind, searchedFor: parse<string[]>(t?.terms, []), source: m.source, place: m.place, title: m.title, text: m.text.slice(0, 1500) };
      }),
    }, READ_SCHEMA);
    const reads = parseReads(out, batch.length);
    await db.$transaction(
      batch.map((m, i) => {
        const r = reads.get(i);
        // One Claude left out is still marked read, so it can't hold up every check after.
        return db.listenMention.update({
          where: { id: m.id },
          data: r ? { read: true, relevant: r.relevant, sentiment: r.sentiment, themes: JSON.stringify(r.themes), summary: r.summary || null } : { read: true, sentiment: "neutral" },
        });
      }),
    );
    for (const r of reads.values()) for (const t of r.themes) if (!knownThemes.includes(t) && knownThemes.length < 100) knownThemes.push(t);
  }
}

// ---- Insights ----

const INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "customers", "competitors", "opportunities", "risks"],
  properties: {
    headline: { type: "string" },
    customers: { type: "array", items: { type: "string" } },
    competitors: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "takeaway"], properties: { name: { type: "string" }, takeaway: { type: "string" } } },
    },
    opportunities: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
};

const INSIGHT_SYSTEM = `You are the social listening analyst for a small online shop. You get the mentions found online over the last month about the shop ("brand"), its competitors and the keywords it follows, each with its sentiment, themes and a one-line summary, plus counts and the themes trending this week.

Write what the shop owner should take from them, in plain, friendly British English, specific to what the mentions say. Never invent facts or numbers the data doesn't show; when there's little to go on, say so briefly.

- headline: one sentence, the single most useful thing to know right now.
- customers: two to four points on what people say about the shop itself, good and bad, or about its kind of product when nobody mentions the shop.
- competitors: one takeaway per competitor that has mentions, especially complaints the shop could win customers from or praise it should match. Use the competitor's name as given.
- opportunities: two to four concrete things to do next (a post to write, a product page to fix, a complaint to answer, a theme to make content about).
- risks: zero to three things to keep an eye on, such as a rise in complaints.

Each point is one or two sentences.`;

export function parseInsights(out: unknown): Insights | null {
  const o = out as Record<string, unknown> | null;
  if (!o || typeof o.headline !== "string") return null;
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v : []).flatMap((s) => (typeof s === "string" && s.trim() ? [s.trim().slice(0, 500)] : [])).slice(0, n);
  return {
    headline: o.headline.trim().slice(0, 300),
    customers: strs(o.customers, 4),
    competitors: (Array.isArray(o.competitors) ? o.competitors : [])
      .flatMap((c) => {
        const x = c as Record<string, unknown>;
        return typeof x?.name === "string" && typeof x.takeaway === "string" ? [{ name: x.name.slice(0, 100), takeaway: x.takeaway.trim().slice(0, 500) }] : [];
      })
      .slice(0, 8),
    opportunities: strs(o.opportunities, 4),
    risks: strs(o.risks, 3),
  };
}

const at = (m: { publishedAt: Date | null; foundAt: Date }) => m.publishedAt ?? m.foundAt;

// The last month's mentions as Claude reads them, for the insights and for questions.
async function recentForClaude(shop: string, now: Date, take = 250) {
  const [topics, mentions] = await Promise.all([
    db.listenTopic.findMany({ where: { shop } }),
    db.listenMention.findMany({
      where: { shop, read: true, relevant: true, OR: [{ publishedAt: { gte: addDays(now, -30) } }, { publishedAt: null, foundAt: { gte: addDays(now, -30) } }] },
      orderBy: [{ engagement: "desc" }, { foundAt: "desc" }],
      take,
    }),
  ]);
  const topic = new Map(topics.map((t) => [t.id, t]));
  return {
    topics,
    mentions,
    rows: mentions.map((m, i) => ({
      i,
      topic: topic.get(m.topicId)?.name,
      topicType: topic.get(m.topicId)?.kind,
      source: m.source,
      date: at(m).toISOString().slice(0, 10),
      sentiment: m.sentiment,
      themes: parse<string[]>(m.themes, []),
      summary: m.summary ?? m.title ?? m.text.slice(0, 200),
      engagement: m.engagement,
    })),
  };
}

async function writeInsights(shop: string, ask: AskJson, now: Date) {
  const { topics, mentions, rows } = await recentForClaude(shop, now);
  if (!rows.length) return;
  const all = await db.listenMention.findMany({ where: { shop, relevant: true, read: true }, select: { topicId: true, sentiment: true, themes: true, publishedAt: true, foundAt: true } });
  const summary = topics.map((t) => {
    const own = mentions.filter((m) => m.topicId === t.id);
    return { name: t.name, type: t.kind, mentionsThisMonth: own.length, ...splitOf(own.map((m) => m.sentiment)) };
  });
  const trending = themeTrends(all.map((m) => ({ at: at(m), sentiment: m.sentiment, themes: parse<string[]>(m.themes, []) })), now).slice(0, 10);
  const insights = parseInsights(await ask(INSIGHT_SYSTEM, { topics: summary, trendingThisWeek: trending, mentions: rows }, INSIGHT_SCHEMA));
  if (insights) await db.shopSettings.update({ where: { shop }, data: { listenInsights: JSON.stringify(insights), listenInsightsAt: now } });
}

const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "examples"],
  properties: { answer: { type: "string" }, examples: { type: "array", items: { type: "integer" } } },
};

const ASK_SYSTEM = `You answer a small online shop owner's question about what people are saying online, using only the mentions you're given: the last month's posts, videos, comments and pages about the shop ("brand"), its competitors and the keywords it follows, each with its sentiment, themes and summary.

Answer in plain, friendly British English, in a short paragraph or a few short points, specific to the mentions. If the mentions don't answer the question, say so and say what they do show. Never invent facts. examples: the i numbers of up to five mentions that best back up the answer.`;

// A question about the mentions, such as "What themes are trending this week?".
export async function askListening(shop: string, question: string, { ask = claudeJson(), now = new Date() }: { ask?: AskJson | null; now?: Date } = {}) {
  if (!ask) return { error: "Questions aren't switched on for this app yet." };
  const q = question.trim().slice(0, 300);
  if (q.length < 4) return { error: "Type a question." };
  const { mentions, rows } = await recentForClaude(shop, now, 200);
  if (!rows.length) return { error: "There are no mentions from the last month to answer from yet. Press Check now first." };
  const all = await db.listenMention.findMany({ where: { shop, relevant: true, read: true }, select: { sentiment: true, themes: true, publishedAt: true, foundAt: true } });
  const trending = themeTrends(all.map((m) => ({ at: at(m), sentiment: m.sentiment, themes: parse<string[]>(m.themes, []) })), now).slice(0, 10);
  const out = (await ask(ASK_SYSTEM, { today: now.toISOString().slice(0, 10), question: q, trendingThisWeek: trending, mentions: rows }, ASK_SCHEMA)) as { answer?: unknown; examples?: unknown } | null;
  const answer = typeof out?.answer === "string" ? out.answer.trim().slice(0, 3000) : "";
  if (!answer) return { error: "Couldn't answer that just now. Try asking another way." };
  const picks = (Array.isArray(out?.examples) ? out.examples : []).filter((i): i is number => Number.isInteger(i) && i >= 0 && i < mentions.length);
  return {
    answer,
    examples: [...new Set(picks)].slice(0, 5).map((i) => {
      const m = mentions[i];
      return { url: m.url, source: m.source, title: m.title, summary: m.summary, sentiment: m.sentiment };
    }),
  };
}

// ---- Checking ----

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

export type RunDeps = { clients?: ListenClient[]; ask?: AskJson | null; now?: Date };

// Searches every source for every topic, keeps the new mentions, has Claude
// read them, then writes the insights. Claims the shop first so two checks
// can't run at once.
export async function runListening(shop: string, { clients = listenClients(), ask = claudeJson(), now = new Date() }: RunDeps = {}) {
  if (!clients.length) return { error: "Social listening isn't switched on for this app yet." };
  await db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });
  const { count } = await db.shopSettings.updateMany({
    where: { shop, OR: [{ listenRunningAt: null }, { listenRunningAt: { lt: new Date(now.getTime() - STUCK) } }] },
    data: { listenRunningAt: now },
  });
  if (!count) return { error: "A check is already running." };
  try {
    await syncTopics(shop);
    const [topics, market] = await Promise.all([db.listenTopic.findMany({ where: { shop } }), shopMarket(shop)]);
    const jobs = topics.flatMap((t) =>
      parse<string[]>(t.terms, [])
        .slice(0, TERMS_PER_TOPIC)
        .flatMap((term) => clients.map((client) => ({ topic: t, term, client }))),
    );
    let failed = 0;
    let lastError = "";
    let added = 0;
    await inBatches(jobs, AT_ONCE, async ({ topic, term, client }) => {
      let found: Found[];
      try {
        found = await client.search(term, market);
      } catch (err) {
        failed++;
        lastError = err instanceof Error ? err.message : String(err);
        console.error("Couldn't search for mentions", shop, client.source, err);
        return;
      }
      const fresh = found.filter((f) => !f.publishedAt || now.getTime() - f.publishedAt.getTime() < KEEP);
      if (!fresh.length) return;
      const have = new Set(
        (await db.listenMention.findMany({ where: { topicId: topic.id, source: client.source, externalId: { in: fresh.map((f) => f.externalId) } }, select: { externalId: true } })).map((m) => m.externalId),
      );
      for (const f of fresh) {
        if (have.has(f.externalId)) continue;
        have.add(f.externalId);
        await db.listenMention
          .create({ data: { shop, topicId: topic.id, source: client.source, externalId: f.externalId, url: f.url, author: f.author, place: f.place, title: f.title, text: f.text, publishedAt: f.publishedAt, engagement: f.engagement, foundAt: now } })
          .then(() => added++)
          // The same post found by both of a topic's words at once.
          .catch(() => undefined);
      }
    });
    let listenError = jobs.length && failed === jobs.length ? `Couldn't search for mentions: ${lastError}`.slice(0, 300) : null;
    if (ask) {
      try {
        await readMentions(shop, ask);
        const s = await db.shopSettings.findUnique({ where: { shop } });
        if (added || !s?.listenInsightsAt) await writeInsights(shop, ask, now);
      } catch (err) {
        console.error("Couldn't read mentions", shop, err);
        listenError ??= "Found new mentions but couldn't read them all. They'll be read on the next check.";
      }
    }
    await db.listenMention.deleteMany({ where: { shop, foundAt: { lt: new Date(now.getTime() - KEEP) } } });
    await db.shopSettings.update({ where: { shop }, data: { listenCheckedAt: now, listenRunningAt: null, listenError } });
    return listenError ? { error: listenError } : { ok: true as const, added };
  } catch (err) {
    await db.shopSettings.update({ where: { shop }, data: { listenRunningAt: null } });
    throw err;
  }
}

// A check the merchant starts. It runs in the background, since searching
// every source and reading every mention takes a few minutes.
export async function startListening(shop: string, deps: RunDeps = {}) {
  const { clients = listenClients(), now = new Date() } = deps;
  if (!clients.length) return { error: "Social listening isn't switched on for this app yet." };
  await syncTopics(shop);
  if (!(await db.listenTopic.count({ where: { shop } }))) return { error: "Add a keyword or a competitor to listen for first." };
  const s = await db.shopSettings.findUnique({ where: { shop } });
  if (s?.listenRunningAt && now.getTime() - s.listenRunningAt.getTime() < STUCK) return { error: "A check is already running." };
  if (s?.listenCheckedAt && now.getTime() - s.listenCheckedAt.getTime() < MIN_GAP) return { error: "You checked in the last few hours. Try again later." };
  void runListening(shop, { ...deps, clients, now }).catch((err) => console.error("Social listening check failed", shop, err));
  return { started: true as const };
}

// Every few days, from the hourly schedule, for shops that have opened the page.
export async function refreshAllListening(deps: RunDeps = {}) {
  const { clients = listenClients(), now = new Date() } = deps;
  if (!clients.length) return;
  const shops = await db.listenTopic.findMany({ select: { shop: true }, distinct: ["shop"] });
  for (const { shop } of shops) {
    const s = await db.shopSettings.findUnique({ where: { shop } });
    if (s?.listenCheckedAt && now.getTime() - s.listenCheckedAt.getTime() < EVERY) continue;
    await runListening(shop, { ...deps, clients, now }).catch((err) => console.error("Social listening check failed", shop, err));
  }
}

// ---- The page ----

export type Filters = { topic?: string | null; source?: string | null; sentiment?: string | null };

// Everything the Social listening page shows.
export async function listeningView(shop: string, filters: Filters = {}, now = new Date()) {
  const [settings, topics, rows] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.listenTopic.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
    db.listenMention.findMany({
      where: { shop, relevant: true },
      select: { id: true, topicId: true, source: true, sentiment: true, themes: true, publishedAt: true, foundAt: true, engagement: true },
    }),
  ]);
  const order: Record<string, number> = { brand: 0, competitor: 1, keyword: 2 };
  topics.sort((a, b) => order[a.kind] - order[b.kind] || a.createdAt.getTime() - b.createdAt.getTime());
  const mentions = rows.map((m) => ({ ...m, at: at(m), themes: parse<string[]>(m.themes, []) }));
  const monthAgo = addDays(now, -30);
  const twoMonthsAgo = addDays(now, -60);
  const weeks = weekStarts(now, 12);

  const topicStats = topics.map((t) => {
    const own = mentions.filter((m) => m.topicId === t.id);
    const month = own.filter((m) => m.at >= monthAgo);
    const before = own.filter((m) => m.at >= twoMonthsAgo && m.at < monthAgo);
    const split = splitOf(month.map((m) => m.sentiment));
    return {
      id: t.id,
      kind: t.kind as Kind,
      name: t.name,
      terms: parse<string[]>(t.terms, []),
      total: own.length,
      month: month.length,
      before: before.length,
      ...split,
      net: net(split),
      sources: SOURCES.map((s) => ({ source: s.key, name: s.name, count: month.filter((m) => m.source === s.key).length })),
      trend: weeks.map((w, i) => {
        const end = weeks[i + 1] ?? addDays(w, 7);
        const inWeek = own.filter((m) => m.at >= w && m.at < end);
        const s = splitOf(inWeek.map((m) => m.sentiment));
        return { week: w.toISOString().slice(0, 10), count: inWeek.length, net: inWeek.length >= 3 ? net(s) : null, ...s };
      }),
    };
  });
  const voiced = topicStats.filter((t) => t.kind !== "keyword");
  const voiceTotal = voiced.reduce((n, t) => n + t.month, 0);

  const feedWhere = {
    shop,
    relevant: true,
    ...(filters.topic && topics.some((t) => t.id === filters.topic) ? { topicId: filters.topic } : {}),
    ...(filters.source && SOURCES.some((s) => s.key === filters.source) ? { source: filters.source } : {}),
    ...(filters.sentiment && ["positive", "neutral", "negative"].includes(filters.sentiment) ? { sentiment: filters.sentiment } : {}),
  };
  const feed = await db.listenMention.findMany({ where: feedWhere, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { foundAt: "desc" }], take: 60 });
  const topicName = new Map(topics.map((t) => [t.id, t.name]));

  return {
    running: !!settings?.listenRunningAt && now.getTime() - settings.listenRunningAt.getTime() < STUCK,
    checkedAt: settings?.listenCheckedAt?.toISOString() ?? null,
    error: settings?.listenError ?? null,
    insights: parse<Insights | null>(settings?.listenInsights, null),
    insightsAt: settings?.listenInsightsAt?.toISOString() ?? null,
    unread: mentions.length ? await db.listenMention.count({ where: { shop, read: false } }) : 0,
    maxKeywords: MAX_KEYWORDS,
    topics: topicStats,
    voice: voiced.map((t) => ({ id: t.id, kind: t.kind, name: t.name, count: t.month, share: voiceTotal ? Math.round((100 * t.month) / voiceTotal) : null, net: t.net })),
    themes: themeTrends(mentions, now).slice(0, 12),
    weeks: weeks.map((w) => w.toISOString().slice(0, 10)),
    feed: feed.map((m) => ({
      id: m.id,
      topic: topicName.get(m.topicId) ?? "",
      source: m.source as Source,
      url: m.url,
      author: m.author,
      place: m.place,
      title: m.title,
      text: m.text.slice(0, 400),
      summary: m.summary,
      sentiment: m.sentiment as Sentiment | null,
      themes: parse<string[]>(m.themes, []),
      engagement: m.engagement,
      at: at(m).toISOString(),
    })),
  };
}
