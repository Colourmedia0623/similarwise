import { poster, taskResult } from "../traffic/dataforseo.server";
import type { Market } from "../traffic/markets";

// Where social listening looks for mentions: Reddit, YouTube and TikTok
// through Scrape Creators (SCRAPECREATORS_API_KEY), and blogs, news, forums
// and shops across the web through DataForSEO's content search
// (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD). Each is off without its keys.

import type { Source } from "./sources";

export { SOURCES, type Source } from "./sources";

export type Found = {
  externalId: string;
  url: string;
  author: string | null;
  place: string | null;
  title: string | null;
  text: string;
  publishedAt: Date | null;
  engagement: number | null;
};

export type ListenClient = { source: Source; search(term: string, market: Market): Promise<Found[]> };

type Json = Record<string, unknown>;
const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const LIMIT = 40;

// Seconds, milliseconds, or a date string.
export function toDate(v: unknown): Date | null {
  const n = num(v);
  if (n != null && n > 0) return new Date(n < 1e11 ? n * 1000 : n);
  const s = str(v);
  if (!s) return null;
  // DataForSEO writes "2022-08-12 18:40:33 +00:00".
  const d = new Date(s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?([+-]\d{2}:?\d{2})$/, "$1T$2$3"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function ok(json: unknown): Json {
  const body = obj(json);
  if (body.success === false) throw new Error(`Scrape Creators: ${str(body.message) ?? str(body.error) ?? "request failed"}`);
  return body;
}

export function parseReddit(json: unknown): Found[] {
  return arr(ok(json).posts).flatMap((r) => {
    const p = obj(r);
    const id = str(p.id, 40) ?? str(p.name, 40);
    const permalink = str(p.permalink, 500);
    if (!id || (!permalink && !str(p.url))) return [];
    if (p.over_18 === true) return [];
    return [
      {
        externalId: id,
        url: permalink ? (permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`) : str(p.url, 1000)!,
        author: str(p.author, 100),
        place: str(p.subreddit_name_prefixed, 100) ?? (str(p.subreddit, 100) ? `r/${str(p.subreddit, 100)}` : null),
        title: str(p.title, 300),
        text: str(p.selftext, 4000) ?? "",
        publishedAt: toDate(p.created_utc) ?? toDate(p.created_at_iso) ?? toDate(p.created),
        engagement: num(p.score) ?? num(p.ups),
      },
    ];
  });
}

export function parseYoutube(json: unknown): Found[] {
  const body = ok(json);
  return [...arr(body.videos), ...arr(body.shorts)].flatMap((r) => {
    const v = obj(r);
    const id = str(v.id, 40);
    if (!id) return [];
    const channel = obj(v.channel);
    return [
      {
        externalId: id,
        url: str(v.url, 1000) ?? `https://www.youtube.com/watch?v=${id}`,
        author: str(channel.title, 100) ?? str(channel.handle, 100),
        place: str(channel.handle, 100) ?? str(channel.title, 100),
        title: str(v.title, 300),
        text: str(v.description, 4000) ?? "",
        publishedAt: toDate(v.publishedTime),
        engagement: num(v.viewCountInt),
      },
    ];
  });
}

export function parseTiktok(json: unknown): Found[] {
  return arr(ok(json).search_item_list).flatMap((r) => {
    const a = obj(obj(r).aweme_info);
    const id = str(a.aweme_id, 40);
    if (!id) return [];
    const author = obj(a.author);
    const handle = str(author.unique_id, 100);
    const stats = obj(a.statistics);
    return [
      {
        externalId: id,
        url: str(a.share_url, 1000) ?? `https://www.tiktok.com/@${handle ?? "_"}/video/${id}`,
        author: str(author.nickname, 100) ?? handle,
        place: handle ? `@${handle}` : null,
        title: null,
        text: str(a.desc, 4000) ?? "",
        publishedAt: toDate(a.create_time),
        engagement: num(stats.play_count) ?? num(stats.digg_count),
      },
    ];
  });
}

export function parseWeb(json: unknown): Found[] {
  const items = arr(taskResult(json)[0]?.items);
  return items.flatMap((r) => {
    const it = obj(r);
    const url = str(it.url, 1000);
    if (!url) return [];
    const c = obj(it.content_info);
    const title = str(c.main_title, 300) ?? str(c.title, 300);
    const text = str(c.snippet, 4000) ?? str(c.highlighted_text, 4000) ?? "";
    if (!title && !text) return [];
    const social = obj(c.social_metrics ?? it.social_metrics);
    return [
      {
        // The same page can mention a term in several places; keep each place.
        externalId: `${url}#${(str(c.title, 100) ?? "").slice(0, 100)}`.slice(0, 1100),
        url,
        author: str(c.author, 100),
        place: str(it.domain, 200) ?? str(it.main_domain, 200),
        title,
        text,
        publishedAt: toDate(c.date_published),
        engagement: num(social.likes) ?? null,
      },
    ];
  });
}

function scrapeCreators(): ListenClient[] {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) return [];
  const get = async (path: string, params: Record<string, string>) => {
    const res = await fetch(`https://api.scrapecreators.com${path}?${new URLSearchParams(params)}`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Scrape Creators answered ${res.status}`);
    return res.json();
  };
  const quoted = (t: string) => (t.includes(" ") ? `"${t}"` : t);
  return [
    { source: "reddit", search: async (term) => parseReddit(await get("/v1/reddit/search", { query: quoted(term), sort: "new", timeframe: "month", trim: "true" })).slice(0, LIMIT) },
    { source: "youtube", search: async (term, market) => parseYoutube(await get("/v1/youtube/search", { query: term, uploadDate: "this_month", region: market.code })).slice(0, LIMIT) },
    { source: "tiktok", search: async (term) => parseTiktok(await get("/v1/tiktok/search/keyword", { query: term })).slice(0, LIMIT) },
  ];
}

function dataForSeo(): ListenClient[] {
  const post = poster(90_000);
  if (!post) return [];
  return [
    {
      source: "web",
      search: async (term) =>
        parseWeb(
          await post("/content_analysis/search/live", {
            keyword: `"${term.toLowerCase()}"`,
            page_type: ["ecommerce", "news", "blogs", "message-boards"],
            search_mode: "as_is",
            order_by: ["content_info.date_published,desc"],
            limit: LIMIT,
          }),
        ),
    },
  ];
}

export function listenClients(): ListenClient[] {
  return [...scrapeCreators(), ...dataForSeo()];
}
