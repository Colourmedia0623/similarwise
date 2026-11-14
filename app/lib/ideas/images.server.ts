import db from "../../db.server";

// A picture for each blog article, made by OpenAI's image model from the
// article's title and search, stored here and served at /images/<id>.jpg for
// Shopify to fetch as the post's featured image. Off unless OPENAI_API_KEY is set.

// SimilarWise uses the newest picture model the OpenAI account has: it reads
// the account's models (the key needs "List models" set to Read) once a day
// and puts the newest gpt-image first. If the list can't be read, it uses
// the newest models known here. OPENAI_IMAGE_MODEL, if set, goes first.
const KNOWN = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-1"];
const DAY = 86400_000;
let listed: { at: number; models: string[] } | null = null;

// Newest version first; a model's plain name before its dated snapshots.
export function newestFirst(ids: string[]) {
  const version = (id: string) => (id.match(/^gpt-image-(\d+(?:\.\d+)*)/)?.[1] ?? "0").split(".").map(Number);
  const dated = (id: string) => /-\d{4}-\d{2}-\d{2}$/.test(id);
  return ids
    .filter((id) => /^gpt-image-\d/.test(id) && !/mini/.test(id))
    .sort((a, b) => {
      const [va, vb] = [version(a), version(b)];
      for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((vb[i] ?? 0) !== (va[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
      if (dated(a) !== dated(b)) return dated(a) ? 1 : -1;
      return dated(a) ? b.localeCompare(a) : a.localeCompare(b);
    });
}

async function pictureModels(key: string, now = Date.now()) {
  if (!listed || now - listed.at > DAY) {
    let models: string[] = [];
    try {
      const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
      const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      if (res.ok) models = newestFirst((json.data ?? []).map((m) => m.id ?? ""));
    } catch {
      // Falls back to the known models below.
    }
    listed = { at: now, models };
  }
  return [...new Set([process.env.OPENAI_IMAGE_MODEL, ...listed.models, ...KNOWN].filter((m): m is string => !!m))];
}

export const forgetPictureModels = () => {
  listed = null;
};

export type MakeImage = (prompt: string) => Promise<Uint8Array>;

export class ImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Some picture models only work once the OpenAI organisation is verified.
const NEEDS_VERIFYING = /verif/i;
// A project without access to the model is told it "does not exist".
const NO_MODEL = /does not exist|model_not_found|not have access to (the )?model/i;

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
    const json = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
    const got = json.data?.[0];
    if (!res.ok || !(got?.b64_json || got?.url)) throw new ImageError(json.error?.message ?? `OpenAI images: HTTP ${res.status}`, res.status);
    if (got.b64_json) return Buffer.from(got.b64_json, "base64");
    // DALL·E 3 answers with a short-lived link to the picture.
    const pic = await fetch(got.url!, { signal: AbortSignal.timeout(60_000) });
    if (!pic.ok) throw new ImageError(`Couldn't fetch the picture OpenAI made (HTTP ${pic.status}).`, pic.status);
    return Buffer.from(await pic.arrayBuffer());
  };
  return async (prompt) => {
    let last: unknown;
    for (const model of await pictureModels(key)) {
      try {
        return await call({ model, prompt, n: 1, size: "1536x1024", quality: "medium", output_format: "jpeg", output_compression: 82 });
      } catch (err) {
        last = err;
        if (!(err instanceof ImageError)) throw err;
        // A newer model may not take every setting: ask again with just the size.
        if (/unknown parameter|unsupported|invalid value/i.test(err.message)) {
          try {
            return await call({ model, prompt, n: 1, size: "1536x1024" });
          } catch (again) {
            last = again;
            if (!(again instanceof ImageError)) throw again;
          }
        }
        const err2 = last as ImageError;
        if (!(NEEDS_VERIFYING.test(err2.message) || NO_MODEL.test(err2.message) || err2.status === 404 || /unknown parameter|unsupported|invalid value/i.test(err2.message))) throw err2;
        console.warn(`Picture model ${model} isn't available, trying the next:`, err2.message);
      }
    }
    // The last resort, for older accounts.
    try {
      return await call({ model: "dall-e-3", prompt, n: 1, size: "1792x1024", quality: "standard" });
    } catch {
      throw last;
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
  if (NO_MODEL.test(message))
    return "Your OpenAI account can't use the picture models yet. Verify your organisation under Settings, Organization, General on platform.openai.com (it can take up to 15 minutes to apply), then try again.";
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

// TikTok refuses photos bigger than 1080 pixels on a side
// (picture_size_check_failed), and only takes JPEG or WebP. Product photos
// and made pictures are usually bigger, so TikTok gets a smaller JPEG copy,
// asked for with ?for=tiktok.
export const TIKTOK_MAX = 1080;

export async function tiktokCopy(data: Uint8Array) {
  const { default: sharp } = await import("sharp");
  return sharp(data)
    .rotate()
    .resize({ width: TIKTOK_MAX, height: TIKTOK_MAX, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

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
