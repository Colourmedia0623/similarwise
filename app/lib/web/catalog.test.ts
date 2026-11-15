import { describe, expect, it } from "vitest";
import db from "../../db.server";
import { syncWebProducts } from "./catalog.server";
import type { Fetcher } from "../tracker/fetch.server";

const site = (pages: Record<string, unknown>): Fetcher => async (url) => {
  const key = Object.keys(pages).find((k) => url.includes(k));
  return key ? { status: 200, url, body: JSON.stringify(pages[key]) } : { status: 404, url, body: "" };
};

async function workspace(website: string | null) {
  const id = `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  return db.workspace.create({ data: { name: "Candles", shop: `ws-${id}.web.similarwise`, website, country: "GB" } });
}

describe("a web workspace's own products", () => {
  it("are read from a Shopify store's public catalogue", async () => {
    const ws = await workspace("candles.example");
    const n = await syncWebProducts(ws.shop, new Date(), site({ "/products.json?limit=250&page=1": { products: [{ id: 7, handle: "vanilla", title: "Vanilla candle", product_type: "Candles", images: [{ src: "https://cdn/v.jpg" }], variants: [{ price: "12.50" }, { price: "9.99" }] }] } }));
    expect(n).toBe(1);
    expect(await db.shopProduct.findFirst({ where: { shop: ws.shop } })).toMatchObject({ productId: "web:shopify:7", priceCents: 999, currency: "GBP", imageUrl: "https://cdn/v.jpg" });
  });

  it("are read from WooCommerce's Store API when there's no Shopify catalogue", async () => {
    const ws = await workspace("woo.example");
    await syncWebProducts(ws.shop, new Date(), site({ "/wp-json/wc/store/v1/products": [{ id: 3, name: "Rose &amp; Oud", slug: "rose-oud", categories: [{ name: "Diffusers" }], prices: { price: "2400", currency_code: "GBP", currency_minor_unit: 2 } }] }));
    expect(await db.shopProduct.findFirst({ where: { shop: ws.shop } })).toMatchObject({ productId: "web:woo:3", title: "Rose & Oud", priceCents: 2400, handle: "rose-oud" });
  });

  it("explain what's missing when there's nothing to read", async () => {
    await expect(syncWebProducts((await workspace(null)).shop, new Date(), site({}))).rejects.toThrow(/Add your website/);
    await expect(syncWebProducts((await workspace("plain.example")).shop, new Date(), site({}))).rejects.toThrow(/Couldn't find a public product list on plain.example/);
  });
});
