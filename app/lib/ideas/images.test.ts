import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { ImageError, TIKTOK_MAX, forgetPictureModels, imageClient, imageProblem, newestFirst, tiktokCopy } from "./images.server";

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
    forgetPictureModels();
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("picks the newest picture model from the account's list", async () => {
    expect(newestFirst(["gpt-6-sol", "gpt-image-1", "gpt-image-2.5-flare-2026-09-08", "gpt-image-2.6-flare", "gpt-image-2.5-flare", "gpt-image-10", "gpt-image-1-mini", "dall-e-3"])).toEqual([
      "gpt-image-10",
      "gpt-image-2.6-flare",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-flare-2026-09-08",
      "gpt-image-1",
    ]);
    process.env.OPENAI_API_KEY = "sk-test";
    const models: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "gpt-image-3" }, { id: "gpt-6-sol" }, { id: "gpt-image-2.6-flare" }] }));
      models.push(JSON.parse(String(init?.body)).model);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }));
    });
    await imageClient()!("a gift box");
    expect(models).toEqual(["gpt-image-3"]);
  });

  it("uses the newest picture model the account has", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const models: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/models")) return new Response("{}", { status: 403 });
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      if (body.model !== "gpt-image-2.5-flare") return new Response(JSON.stringify({ error: { message: `The model '${body.model}' does not exist.` } }), { status: 400 });
      if ("quality" in body) return new Response(JSON.stringify({ error: { message: "Unknown parameter: 'quality'." } }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("new").toString("base64") }] }));
    });
    const out = await imageClient()!("a gift box");
    expect(Buffer.from(out).toString()).toBe("new");
    expect(models).toEqual(["gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2.5-flare"]);
  });

  it("falls back to DALL·E 3 when the account has none of the newer models", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const models: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "https://files.openai/pic.png") return new Response("jpeg");
      if (url.endsWith("/v1/models")) return new Response("{}", { status: 403 });
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      if (body.model !== "dall-e-3") return new Response(JSON.stringify({ error: { message: `The model '${body.model}' does not exist.` } }), { status: 400 });
      // OpenAI refuses response_format for DALL·E 3 now, and answers with a link.
      if ("response_format" in body) return new Response(JSON.stringify({ error: { message: "Unknown parameter: 'response_format'." } }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ url: "https://files.openai/pic.png" }] }));
    });
    const out = await imageClient()!("a gift box");
    expect(Buffer.from(out).toString()).toBe("jpeg");
    expect(models.at(-1)).toBe("dall-e-3");
    expect(models).toContain("gpt-image-1");
    expect(imageProblem(new ImageError("The model 'dall-e-3' does not exist.", 400))).toMatch(/Verify your organisation/);
  });
});
