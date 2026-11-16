import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { applySeo, readProductPage, savedSuggestions, seoProducts, suggestSeo } from "./products.server";

const SHOP = "seo-test.myshopify.com";

describe("product SEO", () => {
  beforeEach(async () => {
    await db.productSeo.deleteMany({ where: { shop: SHOP } });
  });

  it("lists Shopify products with their SEO title and meta description", async () => {
    const graphql = async () => ({
      data: {
        products: {
          nodes: [
            { id: "gid://shopify/Product/1", handle: "box", title: "Gift box", productType: "Boxes", description: "A sturdy box.", onlineStoreUrl: "https://s/products/box", seo: { title: "", description: "Nice box" }, featuredMedia: null },
          ],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      },
    });
    const page = await seoProducts(SHOP, graphql);
    expect(page.canApply).toBe(true);
    expect(page.next).toBe("c1");
    expect(page.products[0]).toMatchObject({ title: "Gift box", seoTitle: null, seoDescription: "Nice box", productType: "Boxes" });
  });

  it("keeps Claude's suggestions, then applies the merchant's version to Shopify", async () => {
    const product = { id: "gid://shopify/Product/1", handle: "box", title: "GIFT BOX", seoTitle: null, seoDescription: null, description: "Kraft gift box, 20cm.", productType: null, image: null, url: null };
    let input: unknown;
    const ask = async (_s: string, i: unknown) => {
      input = i;
      return { products: [{ id: product.id, title: "Kraft gift box, 20cm", seoTitle: "Kraft Gift Box 20cm | Gift Boxes 3000", seoDescription: "A sturdy 20cm kraft gift box.", why: "Clearer title." }, { id: "other", title: "x", seoTitle: "x", seoDescription: "x", why: "" }] };
    };
    expect(await suggestSeo(SHOP, [product], { ask })).toEqual({ ok: true, count: 1 });
    expect(JSON.stringify(input)).toContain("Kraft gift box, 20cm.");
    const saved = (await savedSuggestions(SHOP, [product.id]))[product.id];
    expect(saved).toMatchObject({ title: "Kraft gift box, 20cm", seoTitle: "Kraft Gift Box 20cm | Gift Boxes 3000", appliedAt: null });

    const calls: unknown[] = [];
    const graphql = async (_q: string, v?: Record<string, unknown>) => {
      calls.push(v);
      return { data: { productUpdate: { product: { id: product.id }, userErrors: [] } } };
    };
    expect(await applySeo(SHOP, graphql, product.id, { title: "Kraft gift box", seoTitle: "My title", seoDescription: "My words" })).toEqual({ ok: true });
    expect(calls[0]).toEqual({ product: { id: product.id, title: "Kraft gift box", seo: { title: "My title", description: "My words" } } });
    const after = (await savedSuggestions(SHOP, [product.id]))[product.id];
    expect(after.seoTitle).toBe("My title");
    expect(after.appliedAt).not.toBeNull();
  });

  it("explains a missing permission, and won't apply for a web workspace", async () => {
    const graphql = async () => ({ errors: [{ message: "Access denied for productUpdate field. Required access: `write_products` access scope." }] });
    expect(await applySeo(SHOP, graphql, "gid://shopify/Product/1", { title: "A", seoTitle: "", seoDescription: "" })).toMatchObject({ error: expect.stringMatching(/permission/) });
    expect(await applySeo("ws-x.web.similarwise", graphql, "web:shopify:1", { title: "A", seoTitle: "", seoDescription: "" })).toMatchObject({ error: expect.stringMatching(/Copy/) });
  });

  it("reads a web product page's title and meta description", async () => {
    const fetcher = async () => ({ status: 200, url: "https://s/p", body: '<html><head><title>Box &amp; Bag</title><meta content="Great boxes" name="description"></head><body><script>x</script><h1>Box</h1></body></html>' });
    expect(await readProductPage("https://s/p", fetcher)).toEqual({ seoTitle: "Box & Bag", seoDescription: "Great boxes", text: "Box & Bag Box" });
  });
});
