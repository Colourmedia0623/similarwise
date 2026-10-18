// Facebook Pages and Instagram business accounts (through Meta's Graph API)
// and TikTok (Login Kit and the Content Posting API): signing in, and
// posting an article's picture with its caption. Each is off until its app
// keys are set: META_APP_ID and META_APP_SECRET, TIKTOK_CLIENT_KEY and
// TIKTOK_CLIENT_SECRET. A Business app signs in with a Facebook Login for
// Business configuration (META_CONFIG_ID) that holds the permissions.

export const GRAPH = "https://graph.facebook.com/v23.0";
const TIKTOK = "https://open.tiktokapis.com/v2";

import type { Network } from "./networks";

export { NETWORK_NAME, type Network } from "./networks";
export type Fetch = typeof fetch;

// Signing in to Meta connects Facebook Pages and the Instagram accounts linked to them.
export const PROVIDER = { facebook: "meta", instagram: "meta", tiktok: "tiktok" } as const;
export type Provider = "meta" | "tiktok";

export const providerOn = (p: Provider) =>
  p === "meta" ? !!(process.env.META_APP_ID && process.env.META_APP_SECRET) : !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);

export const callbackUrl = (p: Provider) => `${process.env.SHOPIFY_APP_URL || ""}/social/callback/${p}`;

const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management", "instagram_basic", "instagram_content_publish"];
const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];

export function authorizeUrl(p: Provider, state: string) {
  if (p === "meta") {
    const config = process.env.META_CONFIG_ID;
    const ask: Record<string, string> = config ? { config_id: config, override_default_response_type: "true" } : { scope: META_SCOPES.join(",") };
    const q = new URLSearchParams({ client_id: process.env.META_APP_ID ?? "", redirect_uri: callbackUrl(p), state, ...ask, response_type: "code" });
    return `https://www.facebook.com/v23.0/dialog/oauth?${q}`;
  }
  const q = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY ?? "", redirect_uri: callbackUrl(p), state, scope: TIKTOK_SCOPES.join(","), response_type: "code" });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

export type Connected = { network: Network; accountId: string; name: string; token: string; refreshToken?: string | null; expiresAt?: Date | null };

type GraphError = { error?: { message?: string } };

async function graph<T>(f: Fetch, path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = `${GRAPH}${path}`;
  const body = new URLSearchParams(params);
  const res = method === "GET" ? await f(`${url}?${body}`, { signal: AbortSignal.timeout(30_000) }) : await f(url, { method, body, signal: AbortSignal.timeout(60_000) });
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta answered ${res.status}`);
  return json;
}

type MetaPage = { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string } };
const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username}";

// The Pages the merchant manages, and the Instagram business account on each.
// Pages held through a business portfolio don't always show under /me/accounts,
// so those are looked for too.
export async function connectMeta(code: string, f: Fetch = fetch): Promise<Connected[]> {
  const id = process.env.META_APP_ID ?? "";
  const secret = process.env.META_APP_SECRET ?? "";
  const short = await graph<{ access_token: string }>(f, "/oauth/access_token", { client_id: id, client_secret: secret, redirect_uri: callbackUrl("meta"), code });
  // A long-lived user token gives Page tokens that don't expire.
  const long = await graph<{ access_token: string }>(f, "/oauth/access_token", { grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: short.access_token });
  const token = long.access_token;
  const list = (path: string) => graph<{ data?: MetaPage[] }>(f, path, { fields: PAGE_FIELDS, access_token: token, limit: "50" }).then((r) => r.data ?? []);
  let pages = await list("/me/accounts");
  if (!pages.length) {
    const businesses = await graph<{ data?: { id: string }[] }>(f, "/me/businesses", { fields: "id", access_token: token, limit: "25" }).catch(() => ({ data: [] }));
    for (const b of businesses.data ?? []) {
      for (const kind of ["owned_pages", "client_pages"]) pages.push(...(await list(`/${b.id}/${kind}`).catch(() => [])));
    }
    pages = pages.filter((p, i) => p.access_token && pages.findIndex((q) => q.id === p.id) === i);
  }
  if (!pages.length) throw new Error(await whyNoPages(f, token));
  return pages.flatMap((p) => [
    { network: "facebook" as const, accountId: p.id, name: p.name, token: p.access_token ?? "" },
    ...(p.instagram_business_account
      ? [{ network: "instagram" as const, accountId: p.instagram_business_account.id, name: p.instagram_business_account.username ? `@${p.instagram_business_account.username}` : p.name, token: p.access_token ?? "" }]
      : []),
  ]);
}

// Names the permissions Facebook held back, which is the usual reason no Pages come through.
async function whyNoPages(f: Fetch, token: string) {
  const granted = await graph<{ data?: { permission: string; status: string }[] }>(f, "/me/permissions", { access_token: token })
    .then((r) => new Set((r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission)))
    .catch(() => null);
  const missing = granted ? META_SCOPES.filter((s) => !granted.has(s)) : [];
  if (missing.length)
    return `Facebook didn't give SimilarWise these permissions: ${missing.join(", ")}. Add them to the app's Facebook Login configuration, then press Connect again and allow them.`;
  return "No Facebook Pages came through. Make sure you picked your shop's Page when signing in, and that you're an admin of it.";
}

type TikTokToken = { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string; error?: string; error_description?: string };

async function tiktokToken(f: Fetch, params: Record<string, string>, now: Date) {
  const res = await f(`${TIKTOK}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY ?? "", client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "", ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as TikTokToken;
  if (!res.ok || !json.access_token) throw new Error(json.error_description || json.error || `TikTok answered ${res.status}`);
  return { token: json.access_token, refreshToken: json.refresh_token ?? null, expiresAt: new Date(now.getTime() + (json.expires_in ?? 86400) * 1000), openId: json.open_id ?? "" };
}

export async function connectTikTok(code: string, f: Fetch = fetch, now = new Date()): Promise<Connected[]> {
  const t = await tiktokToken(f, { code, grant_type: "authorization_code", redirect_uri: callbackUrl("tiktok") }, now);
  const res = await f(`${TIKTOK}/user/info/?fields=open_id,display_name`, { headers: { authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(30_000) });
  const info = (await res.json().catch(() => ({}))) as { data?: { user?: { open_id?: string; display_name?: string } } };
  const user = info.data?.user;
  return [{ network: "tiktok", accountId: user?.open_id || t.openId, name: user?.display_name || "TikTok account", token: t.token, refreshToken: t.refreshToken, expiresAt: t.expiresAt }];
}

export const refreshTikTok = (refreshToken: string, f: Fetch = fetch, now = new Date()) => tiktokToken(f, { grant_type: "refresh_token", refresh_token: refreshToken }, now);

export type Post = { caption: string; title: string; link: string; imageUrl: string };
export type Posted = { remoteId: string; url: string | null; processing?: boolean };

// The article's picture as a photo post, with the link under the caption.
// A plain link post relies on Facebook reading the article's page for its
// picture, which fails while a store is password-protected. Without a
// picture it falls back to a link post.
export async function postFacebook(pageId: string, token: string, post: Post, f: Fetch = fetch): Promise<Posted> {
  if (post.imageUrl) {
    const res = await graph<{ id: string; post_id?: string }>(f, `/${pageId}/photos`, { url: post.imageUrl, caption: `${post.caption}\n\n${post.link}`, access_token: token }, "POST");
    const id = res.post_id ?? res.id;
    return { remoteId: id, url: `https://www.facebook.com/${id}` };
  }
  const res = await graph<{ id: string }>(f, `/${pageId}/feed`, { message: post.caption, link: post.link, access_token: token }, "POST");
  return { remoteId: res.id, url: `https://www.facebook.com/${res.id}` };
}

// Instagram takes a picture and caption in two steps: make the post, then publish it.
export async function postInstagram(igId: string, token: string, post: Post, f: Fetch = fetch): Promise<Posted> {
  const made = await graph<{ id: string }>(f, `/${igId}/media`, { image_url: post.imageUrl, caption: post.caption, access_token: token }, "POST");
  let published: { id: string } | null = null;
  // Instagram fetches the picture first, which can take a few seconds.
  for (let i = 0; i < 6 && !published; i++) {
    try {
      published = await graph<{ id: string }>(f, `/${igId}/media_publish`, { creation_id: made.id, access_token: token }, "POST");
    } catch (err) {
      if (i === 5 || !/not ready|not available|try again|processing/i.test(err instanceof Error ? err.message : "")) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  const media = await graph<{ permalink?: string }>(f, `/${published!.id}`, { fields: "permalink", access_token: token }).catch(() => ({ permalink: undefined }));
  return { remoteId: published!.id, url: media.permalink ?? null };
}

// TikTok's reasons, in words a merchant can act on.
function tiktokProblem(code?: string, message?: string) {
  if (code === "unaudited_client_can_only_post_to_private_accounts")
    return "TikTok only lets SimilarWise post as \"Only me\" to private accounts until it approves the app. Set your TikTok account to private, choose Only me and try again.";
  if (code === "url_ownership_unverified") return "TikTok can't fetch the picture until the SimilarWise address is verified in the TikTok app's URL properties.";
  if (code === "spam_risk_too_many_posts") return "TikTok says you've posted too much today. Try again tomorrow.";
  if (code === "reached_active_user_cap") return "TikTok is busy with SimilarWise's posts today. Try again tomorrow.";
  return [message, code && code !== "ok" ? `(${code})` : ""].filter(Boolean).join(" ");
}

async function tiktokCall<T>(f: Fetch, token: string, path: string, body: object) {
  const res = await f(`${TIKTOK}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || (json.error?.code && json.error.code !== "ok")) throw new Error(tiktokProblem(json.error?.code, json.error?.message) || `TikTok answered ${res.status}`);
  return json.data as T;
}

// The account a TikTok post would go to, and what its owner allows, which
// TikTok's rules say the merchant must see before posting.
export type TikTokCreator = { nickname: string; username: string; avatar: string | null; privacyOptions: string[]; commentDisabled: boolean };

export async function tiktokCreator(token: string, f: Fetch = fetch): Promise<TikTokCreator> {
  const c = await tiktokCall<{ creator_nickname?: string; creator_username?: string; creator_avatar_url?: string; privacy_level_options?: string[]; comment_disabled?: boolean }>(
    f,
    token,
    "/post/publish/creator_info/query/",
    {},
  );
  return {
    nickname: c?.creator_nickname ?? "",
    username: c?.creator_username ?? "",
    avatar: c?.creator_avatar_url ?? null,
    privacyOptions: c?.privacy_level_options ?? [],
    commentDisabled: !!c?.comment_disabled,
  };
}

// Where a TikTok post got to after it was sent. TikTok fetches the picture
// and publishes in the background, so a post can still fail after it was
// accepted.
const TIKTOK_FAILS: Record<string, string> = {
  file_format_check_failed: "TikTok couldn't read the picture. Use a JPEG or WebP picture.",
  picture_size_check_failed: "The picture's size isn't one TikTok accepts. Try a different picture.",
  url_ownership_unverified: "TikTok can't fetch the picture until the SimilarWise address is verified in the TikTok app's URL properties.",
  spam_risk_too_many_posts: "TikTok says you've posted too much today. Try again tomorrow.",
  spam_risk_user_banned_from_posting: "TikTok isn't letting this account post right now.",
  privacy_level_option_mismatch: "TikTok only takes Only me posts to private accounts until it approves SimilarWise.",
  unaudited_client_can_only_post_to_private_accounts: "TikTok only takes Only me posts to private accounts until it approves SimilarWise. Set the account to private.",
};

export type TikTokStatus = { status: "processing" | "posted" } | { status: "failed"; error: string };

export async function tiktokStatus(token: string, publishId: string, f: Fetch = fetch): Promise<TikTokStatus> {
  const d = await tiktokCall<{ status?: string; fail_reason?: string }>(f, token, "/post/publish/status/fetch/", { publish_id: publishId });
  if (d?.status === "PUBLISH_COMPLETE") return { status: "posted" };
  if (d?.status === "FAILED") {
    const reason = d.fail_reason ?? "";
    return { status: "failed", error: TIKTOK_FAILS[reason] ?? `TikTok didn't publish it${reason ? ` (${reason})` : ""}.` };
  }
  return { status: "processing" };
}

// What the merchant chose for one TikTok post. TikTok requires these to be
// picked by hand each time: who can see it, comments, and whether it
// promotes their own brand or someone else's.
export type TikTokChoices = { privacy: string; allowComments: boolean; yourBrand: boolean; brandedContent: boolean };

// A TikTok photo post. Until TikTok has approved the app it only accepts
// "Only me" posts to private accounts.
export async function postTikTok(token: string, post: Post, choices: TikTokChoices, f: Fetch = fetch): Promise<Posted> {
  const creator = await tiktokCreator(token, f);
  if (!creator.privacyOptions.includes(choices.privacy)) throw new Error("Choose who can see the post again; your TikTok account's settings have changed.");
  if (choices.brandedContent && choices.privacy === "SELF_ONLY") throw new Error("Branded content can't be posted as Only me. Choose who can see it.");
  const out = await tiktokCall<{ publish_id?: string }>(f, token, "/post/publish/content/init/", {
    post_info: {
      title: post.title.slice(0, 90),
      description: post.caption.slice(0, 4000),
      privacy_level: choices.privacy,
      disable_comment: creator.commentDisabled || !choices.allowComments,
      brand_organic_toggle: choices.yourBrand,
      brand_content_toggle: choices.brandedContent,
      auto_add_music: true,
    },
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: [post.imageUrl] },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
  });
  return { remoteId: out?.publish_id ?? "", url: null, processing: true };
}
