import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { articleImage } from "../lib/ideas/images.server";
import { articlePicture } from "../lib/ideas/articles.server";

// Blog article pictures, public so Shopify, Instagram and TikTok can fetch
// them when an article is sent or shared, and so the app can show them.
// /images/<articleId>.jpg. An article with no picture made for it gets the
// photo of a product it links to, fetched from Shopify's CDN, since TikTok
// only takes pictures from the app's own address.

// TikTok's proof that this address is ours, which it needs before it will
// fetch pictures from it (URL properties in the TikTok developer app). TikTok
// asks for tiktok<code>.txt under the verified prefix.
// The whole site (production app) is verified by the same file at the top
// level, served from public/.
const TIKTOK_VERIFICATION = [
  "tiktok-developers-site-verification=Tel2Q8BoGFcxQrZ7IT3sce5qmW5t6Qop",
  "tiktok-developers-site-verification=SOmS0sEZGOe7TnRb0G2SqgpMOHkONFeJ",
];

export const loader = async ({ params }: LoaderFunctionArgs) => {
  if (/^tiktok[\w-]*\.txt$/i.test(params.file ?? "")) {
    const code = params.file!.slice(6, -4);
    const line = TIKTOK_VERIFICATION.find((v) => !code || v.endsWith(`=${code}`)) ?? TIKTOK_VERIFICATION[0];
    return new Response(line, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const id = /^([a-z0-9]+)\.jpg$/i.exec(params.file ?? "")?.[1];
  const image = id ? await articleImage(id) : null;
  if (image)
    return new Response(new Uint8Array(image.data), {
      headers: { "Content-Type": image.mime, "Cache-Control": "public, max-age=3600", ETag: `"${image.createdAt.getTime()}"` },
    });
  const a = id ? await db.blogArticle.findUnique({ where: { id } }) : null;
  const picture = a ? await articlePicture(a.shop, { ...a, imageAlt: null }) : null;
  if (!picture || !/^https:\/\/cdn\.shopify\.com\//.test(picture.url)) return new Response("Not found", { status: 404 });
  // Instagram only takes JPEGs; Shopify's CDN converts on request.
  const res = await fetch(`${picture.url}${picture.url.includes("?") ? "&" : "?"}format=pjpg`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) return new Response("Not found", { status: 404 });
  return new Response(await res.arrayBuffer(), {
    headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=3600" },
  });
};
