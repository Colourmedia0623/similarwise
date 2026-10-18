import db from "../../db.server";

// A picture for each blog article, made by OpenAI's image model from the
// article's title and search, stored here and served at /images/<id>.jpg for
// Shopify to fetch as the post's featured image. Off unless OPENAI_API_KEY is set.

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

export type MakeImage = (prompt: string) => Promise<Uint8Array>;

export class ImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// gpt-image-1 only works once the OpenAI organisation is verified, so an
// unverified account falls back to DALL·E 3, which doesn't need it.
const NEEDS_VERIFYING = /verif/i;

export function imageClient(): MakeImage | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const call = async (body: object) => {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    const b64 = json.data?.[0]?.b64_json;
    if (!res.ok || !b64) throw new ImageError(json.error?.message ?? `OpenAI images: HTTP ${res.status}`, res.status);
    return Buffer.from(b64, "base64");
  };
  return async (prompt) => {
    try {
      return await call({ model: MODEL, prompt, n: 1, size: "1536x1024", quality: "medium", output_format: "jpeg", output_compression: 82 });
    } catch (err) {
      if (!(err instanceof ImageError) || !(NEEDS_VERIFYING.test(err.message) || (err.status === 404 && MODEL !== "dall-e-3"))) throw err;
      console.warn("Falling back to dall-e-3 for article images:", err.message);
      return call({ model: "dall-e-3", prompt, n: 1, size: "1792x1024", quality: "standard", response_format: "b64_json" });
    }
  };
}

// What to tell the merchant when OpenAI says no.
export function imageProblem(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  const status = err instanceof ImageError ? err.status : 0;
  if (status === 401 || /incorrect api key|invalid api key/i.test(message))
    return "The OpenAI key isn't working. Make a new key on platform.openai.com and update the OPENAI_API_KEY secret.";
  if (/billing|quota|credit|hard limit/i.test(message))
    return "Your OpenAI account is out of credit. Add some under Settings, Billing on platform.openai.com, then try again.";
  if (NEEDS_VERIFYING.test(message)) return "OpenAI needs your organisation verified first. Do it under Settings, Organization, General on platform.openai.com.";
  if (status === 429) return "OpenAI is busy just now. Try again in a minute.";
  if (/safety|content policy|moderation|rejected/i.test(message)) return "OpenAI wouldn't make a picture for this one. Try again, or upload your own.";
  if (err instanceof Error && err.name === "TimeoutError") return "OpenAI took too long. Try again.";
  return message ? `Couldn't make a picture: ${message.slice(0, 200)}` : "Couldn't make a picture for this article. Try again.";
}

// JPEG, PNG or WebP, from the file's first bytes.
export function imageMime(data: Uint8Array) {
  if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
  if (data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57) return "image/webp";
  return "image/jpeg";
}

export function imagePrompt(a: { title: string; keyword: string; summary: string }) {
  return [
    `A natural, high-quality editorial photograph to head a shop's blog post titled "${a.title}", for people searching "${a.keyword}".`,
    a.summary ? `The post: ${a.summary}` : "",
    "Show the products or the moment the post is about, styled simply in soft natural light, with space around the subject.",
    "No text, letters, logos, brand names, watermarks or borders anywhere in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}

export const imageUrl = (articleId: string) => `${process.env.SHOPIFY_APP_URL || ""}/images/${articleId}.jpg`;

// Makes (or remakes) the picture for an article. Failures are kept on the
// article, which can still be sent without one.
export async function makeArticleImage(shop: string, articleId: string, make: MakeImage | null = imageClient()) {
  if (!make) return { error: "Article images aren't switched on for this app yet." };
  const a = await db.blogArticle.findFirst({ where: { id: articleId, shop } });
  if (!a) return { error: "That article isn't there any more." };
  try {
    const data = new Uint8Array(await make(imagePrompt(a)));
    const mime = imageMime(data);
    await db.articleImage.upsert({ where: { articleId }, update: { data, mime, createdAt: new Date() }, create: { articleId, shop, data, mime } });
    await db.blogArticle.update({ where: { id: articleId }, data: { imageAlt: a.title.slice(0, 200), imageError: null } });
    return { ok: true as const };
  } catch (err) {
    console.error("Couldn't make an article image", shop, articleId, err);
    const imageError = imageProblem(err);
    await db.blogArticle.update({ where: { id: articleId }, data: { imageError } });
    return { error: imageError };
  }
}

const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];

// The merchant's own picture for an article, in place of a made one.
export async function uploadArticleImage(shop: string, articleId: string, file: { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }) {
  if (!UPLOAD_TYPES.includes(file.type)) return { error: "Choose a JPG, PNG or WebP picture." };
  if (file.size > 8_000_000) return { error: "Choose a picture under 8 MB." };
  const a = await db.blogArticle.findFirst({ where: { id: articleId, shop } });
  if (!a) return { error: "That article isn't there any more." };
  const data = new Uint8Array(await file.arrayBuffer());
  await db.articleImage.upsert({ where: { articleId }, update: { data, mime: file.type, createdAt: new Date() }, create: { articleId, shop, data, mime: file.type } });
  await db.blogArticle.update({ where: { id: articleId }, data: { imageAlt: a.imageAlt ?? a.title.slice(0, 200), imageError: null } });
  return { ok: true as const };
}

export async function articleImage(articleId: string) {
  return db.articleImage.findUnique({ where: { articleId } });
}
