import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { TIKTOK_MAX, tiktokCopy } from "./images.server";

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
