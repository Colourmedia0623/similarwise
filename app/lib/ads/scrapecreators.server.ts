// Scrape Creators: the public Meta, TikTok and Google ad libraries through one
// API, one credit per request. Off unless SCRAPECREATORS_API_KEY is set.

const API = "https://api.scrapecreators.com";

export type Platform = "meta" | "tiktok" | "google";

export type LibraryAd = {
  platform: Platform;
  adId: string;
  advertiser: string | null; // The page or account running it, as the library names it
  title: string | null;
  text: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  linkUrl: string | null;
  adUrl: string | null;
  cta: string | null;
  placements: string[];
  format: string | null;
  startedAt: Date | null;
  lastShownAt: Date | null;
  active: boolean;
};

export type MetaPage = { id: string; name: string; likes: number | null; alias: string | null; instagram: string | null };

// complete: false when the library has more pages than the one read, so ads
// missing from it may still be running.
export type AdsPage = { ads: LibraryAd[]; complete: boolean };

export type AdsClient = {
  metaPages(query: string): Promise<MetaPage[]>;
  metaAds(pageId: string, country: string): Promise<AdsPage>;
  tiktokAds(advertiser: string): Promise<AdsPage & { resolved: string | null; matches: string[] }>;
  googleAds(domain: string, region: string): Promise<AdsPage & { estimate: number | null }>;
};

type Json = Record<string, unknown>;
const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const RECENT = 7 * 24 * 3600_000;

// Seconds, milliseconds, or a date string.
export function toDate(v: unknown): Date | null {
  const n = num(v);
  if (n != null && n > 0) return new Date(n < 1e11 ? n * 1000 : n);
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ok(json: unknown): Json {
  const body = obj(json);
  if (body.success === false) throw new Error(`Scrape Creators: ${str(body.message) ?? str(body.error) ?? "request failed"}`);
  return body;
}

// Catalogue ads leave placeholders like {{product.name}} in the text.
const real = (s: string | null) => (s && !/\{\{.*\}\}/.test(s) ? s : null);

export function parseMetaPages(json: unknown): MetaPage[] {
  return arr(ok(json).searchResults).flatMap((r) => {
    const p = obj(r);
    const id = str(p.page_id);
    const name = str(p.name, 200);
    if (!id || !name || p.page_is_deleted === true) return [];
    return [{ id, name, likes: num(p.likes), alias: str(p.page_alias, 200), instagram: str(p.ig_username, 200) }];
  });
}

export function parseMetaAds(json: unknown): AdsPage {
  const body = ok(json);
  const ads = arr(body.results).flatMap((r) => {
    const a = obj(r);
    const id = str(a.ad_archive_id);
    if (!id) return [];
    const snap = obj(a.snapshot);
    const card = obj(arr(snap.cards)[0]);
    const video = obj(arr(snap.videos)[0] ?? arr(card.videos ?? [])[0]);
    const image = obj(arr(snap.images)[0]);
    return [
      {
        platform: "meta" as const,
        adId: id,
        advertiser: str(a.page_name, 200) ?? str(snap.page_name, 200),
        title: real(str(snap.title, 300)) ?? real(str(card.title, 300)),
        text: real(str(obj(snap.body).text)) ?? real(str(card.body)),
        imageUrl:
          str(image.original_image_url) ??
          str(image.resized_image_url) ??
          str(card.original_image_url) ??
          str(card.resized_image_url) ??
          str(video.video_preview_image_url) ??
          str(card.video_preview_image_url),
        videoUrl: str(video.video_sd_url) ?? str(video.video_hd_url) ?? str(card.video_sd_url),
        linkUrl: str(snap.link_url, 1000) ?? str(card.link_url, 1000),
        adUrl: `https://www.facebook.com/ads/library/?id=${id}`,
        cta: str(snap.cta_text, 60) ?? str(card.cta_text, 60),
        placements: arr(a.publisher_platform).filter((x): x is string => typeof x === "string"),
        format: str(snap.display_format, 40),
        startedAt: toDate(a.start_date),
        lastShownAt: toDate(a.end_date),
        active: a.is_active !== false,
      },
    ];
  });
  return { ads, complete: !str(body.cursor) };
}

export function parseTiktokAds(json: unknown, now = new Date()) {
  const body = ok(json);
  const ads = arr(body.ads).flatMap((r): LibraryAd[] => {
    const a = obj(r);
    const id = str(a.id);
    if (!id) return [];
    const video = obj(arr(a.videos)[0]);
    const last = toDate(a.last_shown_date);
    return [
      {
        platform: "tiktok",
        adId: id,
        advertiser: str(a.name, 200),
        title: null,
        text: null,
        imageUrl: str(video.cover_img) ?? str(arr(a.image_urls)[0]),
        videoUrl: str(video.video_url),
        linkUrl: null,
        adUrl: str(a.url, 1000),
        cta: null,
        placements: ["TIKTOK"],
        format: arr(a.videos).length ? "VIDEO" : "IMAGE",
        startedAt: toDate(a.first_shown_date),
        lastShownAt: last,
        active: last == null || now.getTime() - last.getTime() < RECENT,
      },
    ];
  });
  return {
    resolved: str(body.resolved_advertiser_name, 200),
    matches: arr(body.advertiser_matches).flatMap((m) => str(obj(m).name, 200) ?? []).slice(0, 10),
    ads,
    complete: body.has_more !== true,
  };
}

export function parseGoogleAds(json: unknown, now = new Date()) {
  const body = ok(json);
  const ads = arr(body.ads).flatMap((r): LibraryAd[] => {
    const a = obj(r);
    const id = str(a.creativeId);
    if (!id) return [];
    const last = toDate(a.lastShown);
    return [
      {
        platform: "google",
        adId: id,
        advertiser: str(a.advertiserName, 200),
        title: null,
        text: null,
        imageUrl: str(a.imageUrl),
        videoUrl: null,
        linkUrl: null,
        adUrl:
          str(a.adUrl, 1000) ??
          (str(a.advertiserId) ? `https://adstransparency.google.com/advertiser/${str(a.advertiserId)}/creative/${id}` : null),
        cta: null,
        placements: ["GOOGLE"],
        format: str(a.format, 40)?.toUpperCase() ?? null,
        startedAt: toDate(a.firstShown),
        lastShownAt: last,
        active: last == null || now.getTime() - last.getTime() < RECENT,
      },
    ];
  });
  return { estimate: num(body.number_of_ads_estimate), ads, complete: !str(body.cursor) };
}

export function adsClient(): AdsClient | null {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) return null;
  const get = async (path: string, params: Record<string, string>) => {
    const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Scrape Creators answered ${res.status}`);
    return res.json();
  };
  return {
    async metaPages(query) {
      return parseMetaPages(await get("/v1/facebook/adLibrary/search/companies", { query }));
    },
    async metaAds(pageId, country) {
      return parseMetaAds(
        await get("/v1/facebook/adLibrary/company/ads", { pageId, country, status: "ACTIVE", sort_by: "total_impressions" }),
      );
    },
    async tiktokAds(advertiser) {
      return parseTiktokAds(await get("/v1/tiktok/ad-library/search", { advertiser_name: advertiser }));
    },
    async googleAds(domain, region) {
      return parseGoogleAds(await get("/v1/google/company/ads", { domain, region }));
    },
  };
}
