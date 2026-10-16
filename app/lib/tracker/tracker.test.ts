import { describe, expect, it } from "vitest";
import { normalizeStoreUrl } from "./url";
import { detectStorefront } from "./detect";
import { parseProducts } from "./products";
import { diffList, diffProducts } from "./diff";
import { isPrivateAddress } from "./fetch.server";

describe("normalizeStoreUrl", () => {
  it("turns what merchants type into the store's origin", () => {
    expect(normalizeStoreUrl("rival.com")).toBe("https://rival.com");
    expect(normalizeStoreUrl(" https://WWW.Rival.co.uk/collections/all?x=1 ")).toBe("https://www.rival.co.uk");
    expect(normalizeStoreUrl("http://shop.rival.com/")).toBe("https://shop.rival.com");
  });

  it("refuses things that aren't public web addresses", () => {
    for (const bad of ["", "rival", "localhost", "127.0.0.1", "http://10.0.0.1", "ftp://rival.com", "https://a:b@rival.com", "rival.com:8080", "javascript:alert(1)"])
      expect(normalizeStoreUrl(bad), bad).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("spots addresses on private networks", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["23.227.38.65", "8.8.8.8", "2606:4700::1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

const SHOPIFY_HOME = `<!doctype html><html><head>
<title>Rival Outdoor &amp; Co – Jackets</title>
<meta property="og:site_name" content="Rival Outdoor &amp; Co">
<script src="//cdn.shopify.com/s/files/1/theme.js"></script>
<script>Shopify.shop = "rival.myshopify.com";
Shopify.currency = {"active":"GBP","rate":"1.0"};
Shopify.theme = {"name":"Dawn copy","id":123,"schema_name":"Dawn","schema_version":"15.0.0","theme_store_id":887,"role":"main"};</script>
<script src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=X"></script>
<script src="https://cdn.judge.me/widget.js"></script>
<script>!function(f,b,e,v){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123');</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
<script>gtag('config','AW-123456789');</script>
<script>ttq.load('C123');</script>
</head><body></body></html>`;

describe("detectStorefront", () => {
  it("reads a Shopify store's theme, apps and ad pixels", () => {
    const s = detectStorefront(SHOPIFY_HOME);
    expect(s).toMatchObject({ name: "Rival Outdoor & Co", isShopify: true, theme: "Dawn", currency: "GBP" });
    expect(s.apps).toEqual(["Klaviyo", "Judge.me"]);
    expect(s.adChannels).toEqual(["Meta (Facebook & Instagram)", "Google Ads", "Google Analytics", "TikTok"]);
  });

  it("knows a store that isn't on Shopify", () => {
    const s = detectStorefront("<html><head><title>Big Brand | Home</title></head></html>");
    expect(s).toMatchObject({ name: "Big Brand", isShopify: false, theme: null, apps: [], adChannels: [] });
  });
});

describe("parseProducts", () => {
  it("takes the lowest variant price and a real compare-at price", () => {
    const [p, q] = parseProducts({
      products: [
        {
          id: 1,
          handle: "storm-jacket",
          title: "Storm Jacket",
          product_type: "Jackets",
          published_at: "2026-10-01T10:00:00Z",
          variants: [
            { price: "120.00", compare_at_price: "150.00" },
            { price: "99.50", compare_at_price: null },
          ],
        },
        { id: 2, handle: "cap", title: "Cap", variants: [{ price: "20.00", compare_at_price: "20.00" }] },
        { id: 3, title: "No variants", variants: [] },
      ],
    });
    expect(p).toMatchObject({ productId: "1", priceCents: 9950, compareAtCents: 15000, productType: "Jackets" });
    expect(p.publishedAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(q).toMatchObject({ productId: "2", priceCents: 2000, compareAtCents: null, productType: null });
  });

  it("copes with junk", () => {
    expect(parseProducts(null)).toEqual([]);
    expect(parseProducts({ products: "nope" })).toEqual([]);
  });
});

describe("diffProducts", () => {
  const seen = (productId: string, title: string, priceCents: number) => ({
    productId,
    title,
    priceCents,
    handle: title,
    productType: null,
    compareAtCents: null,
    publishedAt: null,
  });

  it("finds launches, price changes and products taken down", () => {
    const before = [
      { productId: "1", title: "Jacket", priceCents: 10000 },
      { productId: "2", title: "Cap", priceCents: 2000 },
      { productId: "3", title: "Gloves", priceCents: 1500 },
    ];
    const after = [seen("1", "Jacket", 8000), seen("2", "Cap", 2500), seen("4", "Boots", 12000)];
    expect(diffProducts(before, after, "GBP")).toEqual([
      { kind: "launch", message: "Launched “Boots” at £120.00" },
      { kind: "price_down", message: "“Jacket” went from £100.00 to £80.00" },
      { kind: "price_up", message: "“Cap” went from £20.00 to £25.00" },
      { kind: "removed", message: "Took down “Gloves”" },
    ]);
  });

  it("sums up a flood of launches in one line", () => {
    const after = Array.from({ length: 30 }, (_, i) => seen(String(i), `P${i}`, 100));
    const changes = diffProducts([], after, null);
    expect(changes).toHaveLength(26);
    expect(changes[25]).toEqual({ kind: "launch", message: "…and launched 5 more products" });
  });
});

describe("diffList", () => {
  it("reports apps and pixels added and dropped", () => {
    expect(diffList(["Meta (Facebook & Instagram)"], ["TikTok"], "channel")).toEqual([
      { kind: "channel_added", message: "Started using TikTok (ad or analytics pixel)" },
      { kind: "channel_removed", message: "Stopped using Meta (Facebook & Instagram) (ad or analytics pixel)" },
    ]);
  });
});
