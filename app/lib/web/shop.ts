// Web workspaces (people who signed up at the website rather than installing
// from Shopify) get a made-up shop key, so every table's shop column and every
// background job works for them unchanged. It can never clash with a real
// store, whose keys all end in .myshopify.com or a custom shop domain.

export const WEB_SHOP_SUFFIX = ".web.similarwise";

export const isWebShop = (shop: string) => shop.endsWith(WEB_SHOP_SUFFIX);

export function newWebShop(rand: string) {
  return `ws-${rand.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16)}${WEB_SHOP_SUFFIX}`;
}

// What a workspace's own site is, from whatever was typed: "https://www.Gift.co.uk/shop" → "gift.co.uk".
export function cleanWebsite(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    const host = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export const PLATFORMS = [
  { value: "shopify", label: "Shopify" },
  { value: "woocommerce", label: "WooCommerce" },
  { value: "wix", label: "Wix" },
  { value: "squarespace", label: "Squarespace" },
  { value: "bigcommerce", label: "BigCommerce" },
  { value: "other", label: "Another platform" },
  { value: "none", label: "No store (an agency, or just researching)" },
] as const;

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
