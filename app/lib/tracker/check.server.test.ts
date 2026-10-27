import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { addCompetitor, checkCompetitor, MAX_COMPETITORS, maxCompetitors, removeCompetitor } from "./check.server";
import type { Fetcher } from "./fetch.server";
import { redactShop } from "../privacy.server";
import { overview } from "../dashboard.server";

const SHOP = "mine.myshopify.com";

const home = (extra = "") =>
  `<html><head><meta property="og:site_name" content="Rival">
<script>Shopify.shop="rival.myshopify.com";Shopify.currency = {"active":"USD","rate":"1.0"};
Shopify.theme = {"name":"Dawn","schema_name":"Dawn"};</script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>${extra}</head></html>`;

const product = (id: number, title: string, price: string) => ({
  id,
  handle: title.toLowerCase(),
  title,
  variants: [{ price }],
});

// A fake competitor store whose pages the test changes between checks.
function store(pages: { home: string; products: object[] }): Fetcher {
  return async (url) => {
    if (url.includes("/products.json")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return { status: 200, url, body: JSON.stringify({ products: page === 1 ? pages.products : [] }) };
    }
    return { status: 200, url, body: pages.home };
  };
}

beforeEach(async () => {
  await db.competitor.deleteMany();
});

describe("tracking a competitor", () => {
  it("adds a store, then records what changes on the next check", async () => {
    const pages = { home: home(), products: [product(1, "Jacket", "100.00"), product(2, "Cap", "20.00")] };
    const fetcher = store(pages);
    const added = await addCompetitor(SHOP, "https://www.rival.com/collections/all", fetcher);
    expect(added).toHaveProperty("id");
    const id = (added as { id: string }).id;

    let c = await db.competitor.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({
      url: "https://www.rival.com",
      name: "Rival",
      isShopify: true,
      theme: "Dawn",
      currency: "USD",
      productCount: 2,
      avgPriceCents: 6000,
      lastError: null,
    });
    expect(JSON.parse(c.adChannels)).toEqual(["Meta (Facebook & Instagram)"]);
    expect((await db.competitorEvent.findMany({ where: { competitorId: id } })).map((e) => e.message)).toEqual([
      "Started tracking 2 products",
    ]);

    pages.home = home('<script src="https://analytics.tiktok.com/i18n/pixel/events.js"></script>');
    pages.products = [product(1, "Jacket", "80.00"), product(3, "Boots", "150.00")];
    await checkCompetitor(id, fetcher);

    c = await db.competitor.findUniqueOrThrow({ where: { id } });
    expect(c.productCount).toBe(2);
    const events = await db.competitorEvent.findMany({ where: { competitorId: id, kind: { not: "tracking" } } });
    expect(events.map((e) => e.message).sort()).toEqual(
      [
        "Launched “Boots” at $150.00",
        "Started using TikTok (ad or analytics pixel)",
        "Took down “Cap”",
        "“Jacket” went from $100.00 to $80.00",
      ].sort(),
    );
    const cap = await db.competitorProduct.findFirstOrThrow({ where: { competitorId: id, productId: "2" } });
    expect(cap.removedAt).not.toBeNull();
    expect(await db.competitorSnapshot.count({ where: { competitorId: id } })).toBe(2);

    const o = await overview(SHOP);
    expect(o.week).toEqual({ launches: 1, priceChanges: 1, removed: 1, channelChanges: 1 });
    expect(o.competitors[0].adChannels).toEqual(["Meta (Facebook & Instagram)", "TikTok"]);
  });

  it("refuses bad addresses, duplicates and going over the limit", async () => {
    const fetcher = store({ home: home(), products: [] });
    expect(await addCompetitor(SHOP, "not a site", fetcher)).toEqual({
      error: "Enter the competitor's website, like rival.com.",
    });
    await addCompetitor(SHOP, "rival.com", fetcher);
    expect(await addCompetitor(SHOP, "https://rival.com/", fetcher)).toEqual({
      error: "You're already tracking Rival.",
    });
    for (let i = 1; i < MAX_COMPETITORS; i++) await addCompetitor(SHOP, `rival${i}.com`, fetcher);
    expect(await addCompetitor(SHOP, "one-too-many.com", fetcher)).toEqual({
      error: `You can track up to ${MAX_COMPETITORS} competitors.`,
    });
  });

  it("lets Dye Sub Supplies track 20 competitors", () => {
    expect(maxCompetitors(SHOP)).toBe(5);
    expect(maxCompetitors("7fa72e-da.myshopify.com")).toBe(20);
  });

  it("notes a store it can't reach instead of failing", async () => {
    const down: Fetcher = async () => {
      throw new Error("timed out");
    };
    const added = (await addCompetitor(SHOP, "rival.com", down)) as { id: string };
    const c = await db.competitor.findUniqueOrThrow({ where: { id: added.id } });
    expect(c.lastError).toBe("Couldn't reach the store: timed out");
    expect(c.lastCheckedAt).not.toBeNull();
  });

  it("deletes a competitor's history when removed, and everything on shop redact", async () => {
    const fetcher = store({ home: home(), products: [product(1, "Jacket", "1.00")] });
    const a = (await addCompetitor(SHOP, "rival.com", fetcher)) as { id: string };
    await addCompetitor(SHOP, "other.com", fetcher);
    await addCompetitor("someone-else.myshopify.com", "rival.com", fetcher);
    await removeCompetitor("someone-else.myshopify.com", a.id); // Not theirs: nothing happens.
    expect(await db.competitor.count({ where: { shop: SHOP } })).toBe(2);
    await removeCompetitor(SHOP, a.id);
    expect(await db.competitorProduct.count({ where: { competitorId: a.id } })).toBe(0);
    expect(await redactShop(SHOP)).toEqual({ competitors: 1, sessions: 0 });
    expect(await db.competitor.count()).toBe(1);
  });
});
