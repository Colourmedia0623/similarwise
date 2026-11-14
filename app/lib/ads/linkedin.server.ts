import type { AdsPage, LibraryAd } from "./scrapecreators.server";

// LinkedIn's own Ad Library API: the public LinkedIn ads an advertiser has
// run in the last year. Uses the SimilarWise LinkedIn app's keys
// (LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET) with an app token, not a
// merchant's sign-in. Off until both are set.

const AUTH = "https://www.linkedin.com/oauth/v2/accessToken";
const API = "https://api.linkedin.com/rest/adLibrary";
const VERSION = () => process.env.LINKEDIN_VERSION || "202610";
const RECENT = 7 * 24 * 3600_000;

export type LinkedInAdsClient = { ads(advertiser: string): Promise<AdsPage> };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const time = (v: unknown) => (typeof v === "number" && v > 0 ? new Date(v < 1e11 ? v * 1000 : v) : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

// One page of the library's answer. Ads are kept only when LinkedIn names an
// advertiser, so they can be matched to the competitor.
export function parseLinkedInAds(json: unknown, now = new Date()): AdsPage & { total: number | null } {
  const body = obj(json);
  const ads = arr(body.elements).flatMap((e): LibraryAd[] => {
    const a = obj(e);
    const details = obj(a.details);
    const advertiser = obj(details.advertiser);
    const stats = obj(details.adStatistics);
    const url = str(a.adUrl, 1000);
    // The ad's own number, from its address (linkedin.com/ad-library/detail/123).
    const id = url?.match(/(\d+)\/?(?:\?.*)?$/)?.[1] ?? str(a.id);
    if (!id) return [];
    const last = time(stats.latestImpressionAt);
    return [
      {
        platform: "linkedin",
        adId: id,
        advertiser: str(advertiser.advertiserName, 200),
        title: null,
        text: null,
        imageUrl: null,
        videoUrl: null,
        linkUrl: str(advertiser.advertiserUrl, 1000),
        adUrl: url ?? `https://www.linkedin.com/ad-library/detail/${id}`,
        cta: null,
        placements: ["LINKEDIN"],
        format: str(details.type, 40)?.replace(/_/g, " ") ?? null,
        startedAt: time(stats.firstImpressionAt),
        lastShownAt: last,
        active: last == null || now.getTime() - last.getTime() < RECENT,
      },
    ];
  });
  const paging = obj(body.paging);
  const total = typeof paging.total === "number" ? paging.total : null;
  const start = typeof paging.start === "number" ? paging.start : 0;
  return { ads, complete: total == null ? !arr(paging.links).some((l) => obj(l).rel === "next") : start + ads.length >= total, total };
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

// Only the advertiser asked for: LinkedIn's search also returns ads from
// companies whose names merely contain the words.
export const sameAdvertiser = (ad: LibraryAd, names: string[]) => !!ad.advertiser && names.some((n) => norm(n) && norm(n) === norm(ad.advertiser!));

export function linkedInAdsOn() {
  return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

let cached: { token: string; until: number } | null = null;

async function appToken(f: typeof fetch, now: number) {
  if (cached && cached.until > now + 60_000) return cached.token;
  const res = await f(AUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.LINKEDIN_CLIENT_ID ?? "", client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? "" }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = obj(await res.json().catch(() => ({})));
  const token = str(json.access_token, 5000);
  if (!res.ok || !token) throw new Error(str(json.error_description) ?? str(json.error) ?? `sign-in answered ${res.status}`);
  cached = { token, until: now + (typeof json.expires_in === "number" ? json.expires_in : 1800) * 1000 };
  return token;
}

export function linkedInAdsClient(f: typeof fetch = fetch, now = () => Date.now()): LinkedInAdsClient | null {
  if (!linkedInAdsOn()) return null;
  return {
    async ads(advertiser) {
      const token = await appToken(f, now());
      const res = await f(`${API}?${new URLSearchParams({ q: "criteria", advertiser, start: "0", count: "25" })}`, {
        headers: { authorization: `Bearer ${token}`, "linkedin-version": VERSION(), "x-restli-protocol-version": "2.0.0" },
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) cached = null;
      if (!res.ok) throw new Error(str(obj(json).message) ?? `answered ${res.status}`);
      return parseLinkedInAds(json, new Date(now()));
    },
  };
}

// For tests: forget the app token between runs.
export const forgetLinkedInToken = () => {
  cached = null;
};
