import db from "../../db.server";

// A picture for each blog article, made by OpenAI's image model from the
// article's title and search, stored here and served at /images/<id>.jpg for
// Shopify to fetch as the post's featured image. Off unless OPENAI_API_KEY is set.

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

export type MakeImage = (prompt: string) => Promise<Uint8Array>;

export function imageClient(): MakeImage | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return async (prompt) => {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt, n: 1, size: "1536x1024", quality: "medium", output_format: "jpeg", output_compression: 82 }),
      signal: AbortSignal.timeout(180_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    const b64 = json.data?.[0]?.b64_json;
    if (!res.ok || !b64) throw new Error(json.error?.message ?? `OpenAI images: HTTP ${res.status}`);
    return Buffer.from(b64, "base64");
  };
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
    await db.articleImage.upsert({ where: { articleId }, update: { data, mime: "image/jpeg", createdAt: new Date() }, create: { articleId, shop, data } });
    await db.blogArticle.update({ where: { id: articleId }, data: { imageAlt: a.title.slice(0, 200), imageError: null } });
    return { ok: true as const };
  } catch (err) {
    console.error("Couldn't make an article image", shop, articleId, err);
    const imageError = "Couldn't make a picture for this article. Try again.";
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
