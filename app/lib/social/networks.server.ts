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

// The Pages the merchant manages, and the Instagram business account on each.
export async function connectMeta(code: string, f: Fetch = fetch): Promise<Connected[]> {
  const id = process.env.META_APP_ID ?? "";
  const secret = process.env.META_APP_SECRET ?? "";
  const short = await graph<{ access_token: string }>(f, "/oauth/access_token", { client_id: id, client_secret: secret, redirect_uri: callbackUrl("meta"), code });
  // A long-lived user token gives Page tokens that don't expire.
  const long = await graph<{ access_token: string }>(f, "/oauth/access_token", { grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: short.access_token });
  const pages = await graph<{ data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(f, "/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: long.access_token,
    limit: "50",
  });
  return (pages.data ?? []).flatMap((p) => [
    { network: "facebook" as const, accountId: p.id, name: p.name, token: p.access_token },
    ...(p.instagram_business_account
      ? [{ network: "instagram" as const, accountId: p.instagram_business_account.id, name: p.instagram_business_account.username ? `@${p.instagram_business_account.username}` : p.name, token: p.access_token }]
      : []),
  ]);
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

// A link post on the Page; Facebook shows the article's picture from the link.
export async function postFacebook(pageId: string, token: string, post: Post, f: Fetch = fetch): Promise<Posted> {
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

// A TikTok photo post. TikTok only lets an app post publicly once it has
// passed TikTok's review; before that posts are visible to the poster only.
export async function postTikTok(token: string, post: Post, f: Fetch = fetch): Promise<Posted> {
  const call = async <T>(path: string, body: object) => {
    const res = await f(`${TIKTOK}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
    if (!res.ok || (json.error?.code && json.error.code !== "ok")) throw new Error(json.error?.message || `TikTok answered ${res.status}`);
    return json.data as T;
  };
  const creator = await call<{ privacy_level_options?: string[] }>("/post/publish/creator_info/query/", {});
  const options = creator?.privacy_level_options ?? [];
  const privacy = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : (options[0] ?? "SELF_ONLY");
  const out = await call<{ publish_id?: string }>("/post/publish/content/init/", {
    post_info: { title: post.title.slice(0, 90), description: post.caption.slice(0, 4000), privacy_level: privacy, disable_comment: false, auto_add_music: true },
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: [post.imageUrl] },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
  });
  return { remoteId: out?.publish_id ?? "", url: null, processing: true };
}
