import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { ImageError, TIKTOK_MAX, imageClient, imageProblem, tiktokCopy } from "./images.server";

describe("pictures for TikTok", () => {
  it("shrinks big pictures to a JPEG TikTok accepts, and leaves small ones their size", async () => {
    const big = await sharp({ create: { width: 2048, height: 1536, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 0.5 } } }).png().toBuffer();
    const out = await sharp(await tiktokCopy(big)).metadata();
    expect([out.format, out.width, out.height]).toEqual(["jpeg", TIKTOK_MAX, 810]);
    const small = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#fff" } }).webp().toBuffer();
    const kept = await sharp(await tiktokCopy(small)).metadata();
    expect([kept.format, kept.width, kept.height]).toEqual(["jpeg", 600, 400]);
  });
});

describe("making article pictures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("falls back to DALL·E 3 when the account can't use gpt-image-1", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const models: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "https://files.openai/pic.png") return new Response("jpeg");
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      if (body.model === "gpt-image-1") return new Response(JSON.stringify({ error: { message: "The model 'gpt-image-1' does not exist." } }), { status: 400 });
      // OpenAI refuses response_format for DALL·E 3 now, and answers with a link.
      if ("response_format" in body) return new Response(JSON.stringify({ error: { message: "Unknown parameter: 'response_format'." } }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ url: "https://files.openai/pic.png" }] }));
    });
    const out = await imageClient()!("a gift box");
    expect(Buffer.from(out).toString()).toBe("jpeg");
    expect(models).toEqual(["gpt-image-1", "dall-e-3"]);
    expect(imageProblem(new ImageError("The model 'dall-e-3' does not exist.", 400))).toMatch(/Verify your organisation/);
  });
});
