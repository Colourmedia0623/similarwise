import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { bestMatch, buildIndex, describeGap, similarity, tokens } from "./match";
import {
  confirmMatch,
  priceComparison,
  productMatches,
  setMatch,
  suggestMatches,
  syncIfStale,
  syncShopProducts,
  type Graphql,
} from "./prices.server";
import { redactShop } from "../privacy.server";

const SHOP = "mine.myshopify.com";

// A fake Admin API that returns the given products, two to a page.
function admin(products: { id: string; title: string; price: string; type?: string }[]): Graphql {
  return async (_query, variables) => {
    const start = Number(variables?.after ?? 0);
    const page = products.slice(start, start + 2);
    return {
      data: {
        products: {
          pageInfo: { hasNextPage: start + 2 < products.length, endCursor: String(start + 2) },
          nodes: page.map((p) => ({
            id: p.id,
            handle: p.title.toLowerCase().replace(/\W+/g, "-"),
            title: p.title,
            productType: p.type ?? null,
            priceRangeV2: { minVariantPrice: { amount: p.price, currencyCode: "GBP" } },
          })),
        },
      },
    };
  };
}

async function competitor(name: string, products: [string, number][], currency = "GBP") {
  return db.competitor.create({
    data: {
      shop: SHOP,
      name,
      url: `https://${name.toLowerCase()}.com`,
      currency,
      products: {
        create: products.map(([title, priceCents], i) => ({
          productId: String(i + 1),
          handle: title.toLowerCase().replace(/\W+/g, "-"),
          title,
          priceCents,
        })),
      },
    },
    include: { products: true },
  });
}

beforeEach(async () => {
  await db.competitor.deleteMany();
  await db.shopProduct.deleteMany();
});

describe("matching titles", () => {
  it("normalises sizes and drops filler words", () => {
    expect(tokens("Kraft Gift Box & Lid, 12 x 12 cm")).toEqual(["kraft", "gift", "box", "lid", "12x12cm"]);
  });

  it("scores different sizes of the same thing low", () => {
    const same = similarity(tokens("Kraft gift box 12x12"), tokens("Gift Box Kraft 12 x 12"));
    const other = similarity(tokens("Kraft gift box 12x12"), tokens("Kraft gift box 20x20"));
    expect(same).toBe(1);
    expect(other).toBeLessThan(0.55);
  });

  it("only suggests close enough matches", () => {
    const index = buildIndex([
      { id: "a", title: "Black magnetic gift box large" },
      { id: "b", title: "Tissue paper" },
    ]);
    expect(bestMatch({ id: "x", title: "Large black magnetic gift box" }, index)?.item.id).toBe("a");
    expect(bestMatch({ id: "y", title: "Ribbon spool" }, index)).toBeNull();
  });

  it("describes gaps from the shop's side", () => {
    expect(describeGap(-0.123)).toEqual({ label: "12% cheaper", tone: "critical" });
    expect(describeGap(0.2)).toEqual({ label: "20% dearer", tone: "success" });
    expect(describeGap(0.001).label).toBe("Same price");
    expect(describeGap(null).label).toBe("Other currency");
  });
});

describe("syncing the shop's products", () => {
  it("reads every page and drops products that have gone", async () => {
    const all = [
      { id: "gid://shopify/Product/1", title: "Kraft gift box 12x12", price: "4.00" },
      { id: "gid://shopify/Product/2", title: "Kraft gift box 20x20", price: "6.50" },
      { id: "gid://shopify/Product/3", title: "Tissue paper", price: "2.00" },
    ];
    expect(await syncShopProducts(SHOP, admin(all))).toBe(3);
    expect(await db.shopProduct.count({ where: { shop: SHOP } })).toBe(3);

    await syncShopProducts(SHOP, admin(all.slice(0, 2)));
    const left = await db.shopProduct.findMany({ where: { shop: SHOP }, orderBy: { title: "asc" } });
    expect(left.map((p) => [p.title, p.priceCents])).toEqual([
      ["Kraft gift box 12x12", 400],
      ["Kraft gift box 20x20", 650],
    ]);
  });

  it("only syncs again once the copy is stale", async () => {
    const now = new Date("2026-10-17T10:00:00Z");
    const one = admin([{ id: "gid://shopify/Product/1", title: "Box", price: "1.00" }]);
    expect(await syncIfStale(SHOP, one, now)).toBe(true);
    expect(await syncIfStale(SHOP, one, new Date(now.getTime() + 3600_000))).toBe(false);
    expect(await syncIfStale(SHOP, one, new Date(now.getTime() + 7 * 3600_000))).toBe(true);
  });

  it("fails loudly without product access", async () => {
    await expect(syncShopProducts(SHOP, async () => ({ errors: [{ message: "Access denied" }] }))).rejects.toThrow();
  });
});

describe("comparing prices", () => {
  async function setup() {
    await syncShopProducts(
      SHOP,
      admin([
        { id: "gid://shopify/Product/1", title: "Kraft gift box 12x12", price: "4.00" },
        { id: "gid://shopify/Product/2", title: "Black magnetic gift box", price: "10.00" },
        { id: "gid://shopify/Product/3", title: "Ribbon spool", price: "3.00" },
      ]),
    );
    const rival = await competitor("Rival", [
      ["Gift Box Kraft 12 x 12", 350],
      ["Gift Box Kraft 20 x 20", 550],
      ["Magnetic gift box black", 1200],
    ]);
    const other = await competitor("Other", [["Kraft gift box 12x12", 400]], "EUR");
    return { rival, other };
  }

  it("suggests matches and shows how each competitor's price compares", async () => {
    const { rival } = await setup();
    expect(await suggestMatches(SHOP)).toBe(3);
    expect(await suggestMatches(SHOP)).toBe(0);

    const table = await priceComparison(SHOP);
    expect(table.competitors.map((c) => c.name)).toEqual(["Rival", "Other"]);
    expect(table.totals).toMatchObject({ products: 3, matched: 2, undercut: 1, cheapest: 1 });
    const kraft = table.rows.find((r) => r.title === "Kraft gift box 12x12")!;
    expect(kraft.cells[0]).toMatchObject({ title: "Gift Box Kraft 12 x 12", priceCents: 350, gap: -0.125, confirmed: false });
    expect(kraft.cells[0]!.url).toBe(`${rival.url}/products/gift-box-kraft-12-x-12`);
    // A different currency can't be compared.
    expect(kraft.cells[1]).toMatchObject({ priceCents: 400, gap: null });
    const magnetic = table.rows.find((r) => r.title === "Black magnetic gift box")!;
    expect(magnetic.cells[0]!.gap).toBeCloseTo(0.2);
    expect(table.totals.averageGap).toBeCloseTo((-0.125 + 0.2) / 2);
  });

  it("keeps the merchant's own choices", async () => {
    const { rival } = await setup();
    await suggestMatches(SHOP);
    const kraft = (await db.shopProduct.findFirst({ where: { title: "Kraft gift box 12x12" } }))!;
    const big = rival.products.find((p) => p.title.includes("20 x 20"))!;

    expect(await setMatch(SHOP, kraft.id, rival.id, big.id)).toBe(true);
    await suggestMatches(SHOP);
    let row = (await priceComparison(SHOP)).rows.find((r) => r.id === kraft.id)!;
    expect(row.cells[0]).toMatchObject({ priceCents: 550, confirmed: true });

    // "They don't sell this" takes the product out of the comparison for that competitor.
    await setMatch(SHOP, kraft.id, rival.id, null);
    await suggestMatches(SHOP);
    row = (await priceComparison(SHOP)).rows.find((r) => r.id === kraft.id)!;
    expect(row.cells[0]).toBeNull();
    const detail = (await productMatches(SHOP, kraft.id))!;
    expect(detail.competitors[0].match).toMatchObject({ none: true, product: null });
  });

  it("confirms suggestions, and won't touch another shop's products", async () => {
    const { rival } = await setup();
    await suggestMatches(SHOP);
    const m = (await db.productMatch.findFirst({ where: { competitorId: rival.id } }))!;
    expect(await confirmMatch("thief.myshopify.com", m.id)).toBe(false);
    expect(await confirmMatch(SHOP, m.id)).toBe(true);
    expect((await db.productMatch.findUnique({ where: { id: m.id } }))!.confirmed).toBe(true);

    const own = (await db.shopProduct.findFirst({ where: { shop: SHOP } }))!;
    expect(await setMatch("thief.myshopify.com", own.id, rival.id, null)).toBe(false);
    expect(await productMatches("thief.myshopify.com", own.id)).toBeNull();
  });

  it("finds candidates by search", async () => {
    await setup();
    const kraft = (await db.shopProduct.findFirst({ where: { title: "Kraft gift box 12x12" } }))!;
    const ranked = (await productMatches(SHOP, kraft.id))!;
    expect(ranked.competitors[0].candidates[0].title).toBe("Gift Box Kraft 12 x 12");
    const searched = (await productMatches(SHOP, kraft.id, "20x20"))!;
    expect(searched.competitors[0].candidates.map((c) => c.title)).toEqual(["Gift Box Kraft 20 x 20"]);
  });

  it("deletes the shop's products when the shop is redacted", async () => {
    await setup();
    await redactShop(SHOP);
    expect(await db.shopProduct.count({ where: { shop: SHOP } })).toBe(0);
  });
});
