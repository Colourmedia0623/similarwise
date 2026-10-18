import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { addPrompt, aiVisibility, brandTerms, editPrompt, findBrands, parseAnswer, runAiCheck, startAiCheck, suggestPrompts, type AiClient } from "./mentions.server";

const SHOP = "mentions.myshopify.com";
const NOW = new Date("2026-10-18T09:00:00Z");

const ok = (items: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] });

describe("AI mentions", () => {
  beforeEach(async () => {
    await db.aiAnswer.deleteMany({ where: { shop: SHOP } });
    await db.aiPrompt.deleteMany({ where: { shop: SHOP } });
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopProduct.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("reads an answer's words and the pages it cites", () => {
    const answer = parseAnswer(
      ok([
        { type: "reasoning", sections: [{ text: "thinking" }] },
        {
          type: "message",
          sections: [{ text: "Try Foldabox.", annotations: [{ url: "https://www.foldabox.co.uk/boxes", title: "Foldabox" }, { url: "not a link" }] }],
        },
      ]),
    );
    expect(answer).toEqual({ text: "Try Foldabox.", sources: [{ url: "https://www.foldabox.co.uk/boxes", title: "Foldabox", domain: "foldabox.co.uk" }] });
    expect(() => parseAnswer({ status_code: 40100, status_message: "Not authorised" })).toThrow(/Not authorised/);
  });

  it("finds the brands an answer names, in order, as whole words", () => {
    expect(brandTerms("Gift Boxes 3000 Ltd", "giftboxes3000.co.uk")).toEqual(["gift boxes 3000", "giftboxes3000.co.uk", "giftboxes3000"]);
    const brands = [
      { key: "you", name: "Gift Boxes 3000", domain: "giftboxes3000.co.uk", terms: brandTerms("Gift Boxes 3000", "giftboxes3000.co.uk") },
      { key: "a", name: "Foldabox", domain: "foldabox.co.uk", terms: brandTerms("Foldabox", "foldabox.co.uk") },
      { key: "b", name: "Boxly", domain: "boxly.com", terms: brandTerms("Boxly", "boxly.com") },
    ];
    const text = "1. Foldabox has the widest range. 2. Gift Boxes 3000 is cheaper. Not to be confused with Boxlyfe.";
    expect(findBrands({ text, sources: [{ url: "https://boxly.com/x", title: null, domain: "boxly.com" }] }, brands)).toEqual([
      { key: "a", position: 1, cited: false },
      { key: "you", position: 2, cited: false },
      { key: "b", position: 3, cited: true },
    ]);
  });

  it("asks every question of every assistant and works out who gets named", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.co.uk", aiBrand: "Mine", market: "GB" } });
    const c = await db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://rival.com" } });
    await addPrompt(SHOP, "Where can I buy magnetic gift boxes in the UK?");
    await addPrompt(SHOP, "Best luxury hamper boxes?");
    const asked: string[] = [];
    const client: AiClient = async (platform, prompt, market) => {
      asked.push(`${platform}:${market.code}`);
      if (platform === "gemini" && prompt.startsWith("Best")) throw new Error("timeout");
      const text = platform === "chat_gpt" ? "Mine and Rival both sell them." : "Rival is the best known.";
      return { text, sources: [{ url: "https://reviews.com/a", title: "Reviews", domain: "reviews.com" }] };
    };
    expect(await runAiCheck(SHOP, { client, now: NOW })).toEqual({ ok: true });
    expect(asked).toHaveLength(6);
    expect(asked.every((a) => a.endsWith(":GB"))).toBe(true);

    const v = await aiVisibility(SHOP);
    expect(v.answered).toBe(5);
    expect(v.brands.map((b) => [b.key, b.share])).toEqual([
      ["you", 40],
      [c.id, 100],
    ]);
    expect(v.brands[0].platforms.find((p) => p.name === "ChatGPT")?.share).toBe(100);
    expect(v.prompts[0].answers.find((a) => a.platform === "ChatGPT")).toMatchObject({ you: 1, named: [{ name: "Mine" }, { name: "Rival" }] });
    expect(v.prompts[1].answers.find((a) => a.platform === "Gemini")?.error).toBe("timeout");
    expect(v.sources).toEqual([{ domain: "reviews.com", count: 5, brand: null }]);

    // Not again so soon, and a changed question starts afresh.
    expect(await startAiCheck(SHOP, { client, now: new Date(NOW.getTime() + 3600_000) })).toMatchObject({ error: expect.stringMatching(/last few hours/) });
    await editPrompt(SHOP, v.prompts[0].id, "Where can I buy rigid gift boxes in the UK?");
    expect(await db.aiAnswer.count({ where: { promptId: v.prompts[0].id } })).toBe(0);
  });

  it("suggests questions from the shop's products without repeating any", async () => {
    await db.shopProduct.create({ data: { shop: SHOP, productId: "gid://shopify/Product/1", handle: "box", title: "Pink magnetic gift box", priceCents: 500, currency: "GBP" } });
    await addPrompt(SHOP, "Where can I buy pink gift boxes?");
    const ask = async () => ({ prompts: ["Where can I buy pink gift boxes?", "Best gift box for a bridesmaid proposal?", "  "] });
    expect(await suggestPrompts(SHOP, ask)).toEqual({ count: 1 });
    expect(await db.aiPrompt.count({ where: { shop: SHOP } })).toBe(2);
  });
});
