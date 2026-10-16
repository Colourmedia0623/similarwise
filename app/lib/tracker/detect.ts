// Reads a storefront's home page HTML for what it runs on: whether it is a
// Shopify store, its theme, the apps it uses and the ad and analytics pixels
// it loads (which show the ad channels it is likely paying for).

export type Storefront = {
  name: string | null;
  isShopify: boolean;
  theme: string | null;
  currency: string | null;
  apps: string[];
  adChannels: string[];
};

const APPS: [string, RegExp][] = [
  ["Klaviyo", /static\.klaviyo\.com|klaviyo\.js/i],
  ["Omnisend", /omnisend/i],
  ["Mailchimp", /chimpstatic\.com/i],
  ["Attentive", /attn\.tv|attentivemobile/i],
  ["Postscript", /postscript\.io/i],
  ["Privy", /widget\.privy\.com/i],
  ["Judge.me", /judge\.me|judgeme/i],
  ["Yotpo", /yotpo/i],
  ["Okendo", /okendo/i],
  ["Loox", /loox\.io/i],
  ["Stamped", /stamped\.io/i],
  ["Gorgias", /gorgias/i],
  ["Tidio", /tidio/i],
  ["Recharge", /rechargecdn\.com|rechargeapps\.com/i],
  ["Rebuy", /rebuyengine/i],
  ["Smile.io", /smile\.io|cdn\.sweettooth\.io/i],
  ["Klarna", /klarna/i],
  ["Afterpay", /afterpay/i],
  ["Hotjar", /hotjar/i],
  ["Lucky Orange", /luckyorange/i],
  ["Triple Whale", /triplewhale|triplepixel/i],
  ["Boost Commerce", /boost-pfs|boostcommerce/i],
  ["Searchanise", /searchanise/i],
  ["Gempages", /gempages/i],
  ["PageFly", /pagefly/i],
];

const AD_CHANNELS: [string, RegExp][] = [
  ["Meta (Facebook & Instagram)", /connect\.facebook\.net|fbq\(|facebook-pixel|\\?"pixel_id\\?"/i],
  ["Google Ads", /googleadservices\.com|\bAW-\d{6,}/],
  ["Google Analytics", /\bG-[A-Z0-9]{6,}\b|google-analytics\.com/],
  ["Google Tag Manager", /\bGTM-[A-Z0-9]{4,}\b/],
  ["TikTok", /analytics\.tiktok\.com|ttq\.load|tiktok-pixel/i],
  ["Pinterest", /pintrk\(|ct\.pinterest\.com|s\.pinimg\.com\/ct/i],
  ["Snapchat", /sc-static\.net\/scevent|snaptr\(/i],
  ["Microsoft Ads (Bing)", /bat\.bing\.com/i],
  ["Reddit", /redditstatic\.com\/ads|rdt\(/i],
  ["X (Twitter)", /static\.ads-twitter\.com|twq\(/i],
  ["Criteo", /criteo\.(com|net)/i],
];

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function detectStorefront(html: string): Storefront {
  const isShopify = /cdn\.shopify\.com|Shopify\.shop\s*=|\.myshopify\.com/.test(html);

  let theme: string | null = null;
  const themeJson = html.match(/Shopify\.theme\s*=\s*(\{[^;]*?\})\s*;/);
  if (themeJson) {
    try {
      const t = JSON.parse(themeJson[1]) as { name?: string; schema_name?: string | null };
      theme = t.schema_name || t.name || null;
    } catch {
      theme = null;
    }
  }

  const currency = html.match(/Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/)?.[1] ?? null;

  const siteName =
    html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1] ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.split(/[|–—-]/)[0];

  return {
    name: siteName ? decode(siteName).slice(0, 120) || null : null,
    isShopify,
    theme,
    currency,
    apps: APPS.filter(([, re]) => re.test(html)).map(([n]) => n),
    adChannels: AD_CHANNELS.filter(([, re]) => re.test(html)).map(([n]) => n),
  };
}
