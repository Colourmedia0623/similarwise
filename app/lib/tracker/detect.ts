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

// Well-known storefront apps by what they do, and the script or markup that
// gives each away on a home page.
export const APP_CATEGORIES = [
  "Email & SMS",
  "Pop-ups",
  "Reviews",
  "Chat & support",
  "Subscriptions",
  "Upsells & bundles",
  "Loyalty & referrals",
  "Pay later",
  "Analytics",
  "Search & filters",
  "Page builders",
  "Translation",
  "Cookie consent",
  "Shipping & returns",
  "Wishlists",
  "Social feeds",
  "Accessibility",
] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number];

const APP_LIST: [string, AppCategory, RegExp][] = [
  ["Klaviyo", "Email & SMS", /static\.klaviyo\.com|klaviyo\.js/i],
  ["Omnisend", "Email & SMS", /omnisend/i],
  ["Mailchimp", "Email & SMS", /chimpstatic\.com/i],
  ["Attentive", "Email & SMS", /attn\.tv|attentivemobile/i],
  ["Postscript", "Email & SMS", /postscript\.io/i],
  ["Drip", "Email & SMS", /getdrip\.com/i],
  ["Sendlane", "Email & SMS", /sendlane/i],
  ["Privy", "Pop-ups", /widget\.privy\.com/i],
  ["Justuno", "Pop-ups", /justuno/i],
  ["Wisepops", "Pop-ups", /wisepops/i],
  ["OptiMonk", "Pop-ups", /optimonk/i],
  ["Judge.me", "Reviews", /judge\.me|judgeme/i],
  ["Yotpo", "Reviews", /yotpo/i],
  ["Okendo", "Reviews", /okendo/i],
  ["Loox", "Reviews", /loox\.io/i],
  ["Stamped", "Reviews", /stamped\.io/i],
  ["Reviews.io", "Reviews", /widget\.reviews\.io|widget\.reviews\.co\.uk/i],
  ["Trustpilot", "Reviews", /widget\.trustpilot\.com/i],
  ["Feefo", "Reviews", /feefo/i],
  ["Junip", "Reviews", /junip/i],
  ["Fera", "Reviews", /fera\.ai/i],
  ["Gorgias", "Chat & support", /gorgias/i],
  ["Tidio", "Chat & support", /tidio/i],
  ["Zendesk", "Chat & support", /zdassets\.com/i],
  ["Intercom", "Chat & support", /widget\.intercom\.io|intercomcdn\.com/i],
  ["Re:amaze", "Chat & support", /reamaze/i],
  ["Crisp", "Chat & support", /client\.crisp\.chat/i],
  ["LiveChat", "Chat & support", /livechatinc\.com/i],
  ["Tawk.to", "Chat & support", /embed\.tawk\.to/i],
  ["Recharge", "Subscriptions", /rechargecdn\.com|rechargeapps\.com/i],
  ["Seal Subscriptions", "Subscriptions", /sealsubscriptions/i],
  ["Appstle", "Subscriptions", /appstle/i],
  ["Bold", "Subscriptions", /boldcommerce|boldapps/i],
  ["Skio", "Subscriptions", /skio\.com/i],
  ["Loop Subscriptions", "Subscriptions", /loopsubscriptions/i],
  ["Rebuy", "Upsells & bundles", /rebuyengine/i],
  ["ReConvert", "Upsells & bundles", /reconvert/i],
  ["Frequently Bought Together", "Upsells & bundles", /codeblackbelt|cbb-frequently/i],
  ["Zipify", "Upsells & bundles", /zipify/i],
  ["UpCart", "Upsells & bundles", /upcart/i],
  ["Bundler", "Upsells & bundles", /bundler\.app/i],
  ["Kaching Bundles", "Upsells & bundles", /kaching/i],
  ["Smile.io", "Loyalty & referrals", /smile\.io|cdn\.sweettooth\.io/i],
  ["LoyaltyLion", "Loyalty & referrals", /loyaltylion/i],
  ["Rivo", "Loyalty & referrals", /rivo\.io/i],
  ["Growave", "Loyalty & referrals", /growave/i],
  ["BON Loyalty", "Loyalty & referrals", /bonloyalty/i],
  ["ReferralCandy", "Loyalty & referrals", /referralcandy/i],
  ["Klarna", "Pay later", /klarna/i],
  ["Afterpay", "Pay later", /afterpay/i],
  ["Clearpay", "Pay later", /clearpay/i],
  ["Sezzle", "Pay later", /sezzle/i],
  ["Affirm", "Pay later", /cdn1\.affirm\.com|affirm\.js/i],
  ["Hotjar", "Analytics", /hotjar/i],
  ["Lucky Orange", "Analytics", /luckyorange/i],
  ["Microsoft Clarity", "Analytics", /clarity\.ms/i],
  ["Triple Whale", "Analytics", /triplewhale|triplepixel/i],
  ["Elevar", "Analytics", /elevar/i],
  ["Northbeam", "Analytics", /northbeam/i],
  ["Segment", "Analytics", /cdn\.segment\.com/i],
  ["Heap", "Analytics", /heapanalytics\.com/i],
  ["Boost Commerce", "Search & filters", /boost-pfs|boostcommerce/i],
  ["Searchanise", "Search & filters", /searchanise/i],
  ["Algolia", "Search & filters", /algolia/i],
  ["Klevu", "Search & filters", /klevu/i],
  ["Searchspring", "Search & filters", /searchspring/i],
  ["Doofinder", "Search & filters", /doofinder/i],
  ["Findify", "Search & filters", /findify/i],
  ["Nosto", "Search & filters", /connect\.nosto|nosto\.com/i],
  ["Gempages", "Page builders", /gempages/i],
  ["PageFly", "Page builders", /pagefly/i],
  ["Shogun", "Page builders", /getshogun|shgcdn\.com/i],
  ["EComposer", "Page builders", /ecomposer/i],
  ["Weglot", "Translation", /weglot/i],
  ["Langify", "Translation", /langify/i],
  ["LangShop", "Translation", /langshop/i],
  ["Cookiebot", "Cookie consent", /cookiebot/i],
  ["OneTrust", "Cookie consent", /onetrust|cookielaw\.org/i],
  ["Pandectes", "Cookie consent", /pandectes/i],
  ["Consentmo", "Cookie consent", /consentmo|isenseGDPR/i],
  ["AfterShip", "Shipping & returns", /aftership/i],
  ["Route", "Shipping & returns", /routeapp/i],
  ["Loop Returns", "Shipping & returns", /loopreturns/i],
  ["Narvar", "Shipping & returns", /narvar/i],
  ["Swym Wishlist", "Wishlists", /swym/i],
  ["Wishlist King", "Wishlists", /wishlistking|appmate\.io/i],
  ["Instafeed", "Social feeds", /instafeed/i],
  ["Foursixty", "Social feeds", /foursixty/i],
  ["Elfsight", "Social feeds", /elfsight/i],
  ["accessiBe", "Accessibility", /acsbapp|accessibe/i],
  ["UserWay", "Accessibility", /userway/i],
];

const APPS = APP_LIST.map(([name, , re]) => [name, re] as const);
const CATEGORY = new Map<string, AppCategory>(APP_LIST.map(([name, category]) => [name, category]));

// The category of an app name stored from an earlier check, or null for one
// no longer on the list.
export const appCategory = (name: string): AppCategory | null => CATEGORY.get(name) ?? null;

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
