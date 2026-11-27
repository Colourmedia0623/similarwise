import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import {
  createListing,
  draftListing,
  findCategories,
  savePhotos,
} from "./listing.server";
import {
  descriptionHtml,
  emptyCompliance,
  missingCompliance,
  type Listing,
} from "./listing";

const SHOP = "listing-test.myshopify.com";

const png = async () => {
  const data = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#e33" },
  })
    .png()
    .toBuffer();
  return {
    type: "image/png",
    size: data.byteLength,
    arrayBuffer: async () => new Uint8Array(data).buffer,
  };
};

const answer = {
  title: "Lavender soy candle, 200g",
  description: "A hand-poured soy candle.\n\nBurns for about 40 hours.",
  productType: "Scented candle",
  vendor: "Glow Co",
  tags: ["candles", "lavender"],
  categoryPath: "Home & Garden > Decor > Home Fragrances > Candles",
  categorySearch: "candles",
  attributes: [
    { name: "Scent", value: "Lavender" },
    { name: "Weight", value: "200 g" },
  ],
  seoTitle: "Lavender soy candle 200g | Glow Co",
  seoDescription:
    "A hand-poured lavender soy candle that burns for about 40 hours.",
  compliance: {
    ...emptyCompliance(),
    manufacturer: "Glow Co Ltd",
    warnings: "Never leave a burning candle unattended.",
  },
  check: ["The maker's address wasn't on the label."],
};

const listing = (over: Partial<Listing> = {}): Listing => ({
  ...answer,
  categoryId: "gid://shopify/TaxonomyCategory/hg-3-34",
  price: "12.50",
  ...over,
});

describe("product from photos", () => {
  beforeEach(async () => {
    await db.socialImage.deleteMany({ where: { shop: SHOP } });
  });

  it("keeps up to six photos and needs at least one", async () => {
    expect(await savePhotos(SHOP, [])).toEqual({
      error: "Add at least one photo of the product.",
    });
    const res = await savePhotos(
      SHOP,
      await Promise.all(Array.from({ length: 8 }, png)),
    );
    expect("ids" in res && res.ids?.length).toBe(6);
  });

  it("sends the photos to Claude and picks the closest Shopify category", async () => {
    const saved = (await savePhotos(SHOP, [await png(), await png()])) as {
      ids: string[];
    };
    let seen: { input: unknown; images: unknown[] } | null = null;
    const ask = async (
      _s: string,
      input: unknown,
      _schema: unknown,
      images: unknown[] = [],
    ) => {
      seen = { input, images };
      return answer;
    };
    const graphql = async (_q: string, vars?: Record<string, unknown>) => {
      expect(vars).toEqual({ search: "candles" });
      return {
        data: {
          taxonomy: {
            categories: {
              nodes: [
                {
                  id: "gid://shopify/TaxonomyCategory/ae-2",
                  fullName: "Arts & Entertainment > Candle Making",
                  isLeaf: true,
                },
                {
                  id: "gid://shopify/TaxonomyCategory/hg-3-34",
                  fullName: "Home & Garden > Decor > Home Fragrances > Candles",
                  isLeaf: true,
                },
              ],
            },
          },
        },
      };
    };
    const res = await draftListing(SHOP, saved.ids, "Comes in 3 scents", {
      ask,
      graphql,
    });
    if ("error" in res) throw new Error(res.error);
    expect(seen!.images).toHaveLength(2);
    expect(seen!.input).toMatchObject({
      photos: 2,
      notes: "Comes in 3 scents",
    });
    expect(res.listing.title).toBe("Lavender soy candle, 200g");
    expect(res.listing.categoryId).toBe(
      "gid://shopify/TaxonomyCategory/hg-3-34",
    );
    expect(res.listing.compliance.manufacturer).toBe("Glow Co Ltd");
    expect(res.categories[0].fullName).toContain("Home Fragrances");
  });

  it("says so when Claude isn't switched on or there are no photos", async () => {
    expect(await draftListing(SHOP, ["x"], "", { ask: null })).toEqual({
      error: expect.stringContaining("needs Claude"),
    });
    expect(
      await draftListing(SHOP, ["nope"], "", { ask: async () => answer }),
    ).toEqual({ error: "Add at least one photo of the product." });
  });

  it("returns no categories when Shopify's search fails", async () => {
    expect(
      await findCategories(async () => {
        throw new Error("down");
      }, "candles"),
    ).toEqual([]);
  });

  it("builds a description with details and safety information", () => {
    const html = descriptionHtml(
      listing({ description: "One <b>great</b>.\n\nTwo." }),
    );
    expect(html).toContain("<p>One &lt;b&gt;great&lt;/b&gt;.</p>\n<p>Two.</p>");
    expect(html).toContain("<li><strong>Scent:</strong> Lavender</li>");
    expect(html).toContain("<h3>Safety and product information</h3>");
    expect(html).toContain(
      "<li><strong>Manufacturer:</strong> Glow Co Ltd</li>",
    );
    expect(missingCompliance(answer.compliance)).toEqual([
      "Manufacturer's address",
    ]);
  });

  it("creates a draft product with its photos, category, details and price", async () => {
    const saved = (await savePhotos(SHOP, [await png()])) as { ids: string[] };
    const calls: { q: string; v: Record<string, unknown> }[] = [];
    const graphql = async (q: string, v: Record<string, unknown> = {}) => {
      calls.push({ q, v });
      if (q.includes("productCreate"))
        return {
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/77",
                handle: "c",
                variants: { nodes: [{ id: "gid://shopify/ProductVariant/9" }] },
              },
              userErrors: [],
            },
          },
        };
      return { data: { productVariantsBulkUpdate: { userErrors: [] } } };
    };
    const res = await createListing(SHOP, graphql, listing(), [
      ...saved.ids,
      "someone-elses",
    ]);
    expect(res).toMatchObject({ ok: true, numericId: "77", warning: null });
    const product = calls[0].v.product as Record<string, unknown>;
    expect(product).toMatchObject({
      title: "Lavender soy candle, 200g",
      status: "DRAFT",
      category: "gid://shopify/TaxonomyCategory/hg-3-34",
      vendor: "Glow Co",
      tags: ["candles", "lavender"],
    });
    expect((product.metafields as { key: string }[]).map((m) => m.key)).toEqual(
      ["attributes", "eu_safety"],
    );
    expect(calls[0].v.media).toHaveLength(1);
    expect(calls[1].v).toEqual({
      productId: "gid://shopify/Product/77",
      variants: [{ id: "gid://shopify/ProductVariant/9", price: "12.50" }],
    });
  });

  it("shows Shopify's error when the product can't be created", async () => {
    const graphql = async () => ({
      data: {
        productCreate: {
          product: null,
          userErrors: [{ message: "Title can't be blank" }],
        },
      },
    });
    expect(
      await createListing(SHOP, graphql, listing({ price: "" }), []),
    ).toEqual({ error: "Title can't be blank" });
  });
});
