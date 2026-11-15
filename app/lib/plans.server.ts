import db from "../db.server";
import { PAGES, PLANS, covers, type Tier } from "./billing";
import { isFreeShop } from "./waitlist.server";

// What each plan includes, as the super admin set it on Admin → Packages:
// how many competitors, searches, listening keywords and AI questions, which
// plan each page needs, and the list shown on the plans page. Anything not
// set there stays as in lib/billing.ts. Prices are set in lib/billing.ts,
// since Shopify and Stripe charge from them.

export const LIMITS = [
  { key: "competitors", label: "Competitors tracked", fallback: 5, page: "/app/competitors", line: "Track up to # competitors" },
  { key: "rankKeywords", label: "Searches in the rank tracker", fallback: 50, page: "/app/ranks", line: "Up to # searches in the rank tracker" },
  { key: "aiPrompts", label: "AI mentions questions", fallback: 15, page: "/app/ai", line: "Up to # AI mentions questions" },
  { key: "listenKeywords", label: "Social listening keywords", fallback: 10, page: "/app/listening", line: "Up to # social listening keywords" },
] as const;
export type LimitKey = (typeof LIMITS)[number]["key"];

// Pages whose plan can be changed, with their menu names.
export const PLAN_PAGES: { path: string; label: string }[] = [
  { path: "/app/competitors", label: "Competitors" },
  { path: "/app/similar", label: "Similar sites" },
  { path: "/app/prices", label: "Price comparison" },
  { path: "/app/stock", label: "Out of stock" },
  { path: "/app/tech", label: "Website technologies" },
  { path: "/app/traffic", label: "Traffic and engagement" },
  { path: "/app/channels", label: "Marketing channels" },
  { path: "/app/google", label: "Google Analytics and Ads" },
  { path: "/app/reports", label: "Reports" },
  { path: "/app/keywords", label: "Keyword gap" },
  { path: "/app/ranks", label: "Rank tracker" },
  { path: "/app/audit", label: "Site audit" },
  { path: "/app/ai", label: "AI mentions" },
  { path: "/app/ideas", label: "Keyword ideas" },
  { path: "/app/articles", label: "Blog articles" },
  { path: "/app/calendar", label: "Content calendar" },
  { path: "/app/links", label: "Link gap" },
  { path: "/app/outreach", label: "Outreach emails" },
  { path: "/app/ads", label: "Ads" },
  { path: "/app/ad-ideas", label: "Ad ideas" },
  { path: "/app/listening", label: "Social listening" },
  { path: "/app/social", label: "Social accounts" },
  { path: "/app/publishing", label: "Social calendar" },
  { path: "/app/inbox", label: "Social inbox" },
  { path: "/app/paid-social", label: "Paid social ads" },
];

export type PlanConfig = {
  limits: Record<Tier, Record<LimitKey, number>>;
  pages: Record<string, Tier>;
  includes: Record<Tier, string[]>;
};

const TIERS: Tier[] = ["watch", "grow", "advertise"];
const isTier = (t: unknown): t is Tier => TIERS.includes(t as Tier);

export function defaultPlanConfig(): PlanConfig {
  const limits = {} as PlanConfig["limits"];
  const includes = {} as PlanConfig["includes"];
  for (const p of PLANS) {
    limits[p.tier] = Object.fromEntries(LIMITS.map((l) => [l.key, l.fallback])) as Record<LimitKey, number>;
    includes[p.tier] = [...p.includes];
  }
  const pages = Object.fromEntries(PLAN_PAGES.map(({ path }) => [path, PAGES.find(([p]) => p === path)?.[1] ?? "watch"])) as Record<string, Tier>;
  return { limits, pages, includes };
}

// Reads what's stored over the defaults, ignoring anything that doesn't fit.
export function mergePlanConfig(raw: unknown): PlanConfig {
  const out = defaultPlanConfig();
  const r = (raw ?? {}) as Partial<Record<keyof PlanConfig, Record<string, unknown>>>;
  for (const t of TIERS) {
    const lim = (r.limits?.[t] ?? {}) as Record<string, unknown>;
    for (const l of LIMITS) {
      const n = Number(lim[l.key]);
      if (Number.isInteger(n) && n >= 0 && n <= 10_000) out.limits[t][l.key] = n;
    }
    const inc = r.includes?.[t];
    if (Array.isArray(inc)) out.includes[t] = inc.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 30);
  }
  for (const { path } of PLAN_PAGES) if (isTier(r.pages?.[path])) out.pages[path] = r.pages![path] as Tier;
  return out;
}

const KEY = "plans";
let cached: { at: number; config: PlanConfig } | null = null;

export async function planConfig(now = Date.now()) {
  if (cached && now - cached.at < 30_000) return cached.config;
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let parsed: unknown = null;
  try {
    parsed = row ? JSON.parse(row.value) : null;
  } catch {
    parsed = null;
  }
  cached = { at: now, config: mergePlanConfig(parsed) };
  return cached.config;
}

export async function savePlanConfig(config: PlanConfig) {
  const clean = mergePlanConfig(config);
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(clean) }, update: { value: JSON.stringify(clean) } });
  cached = null;
  return clean;
}

// The plan a page needs.
export async function pageTierFor(path: string): Promise<Tier> {
  const { pages } = await planConfig();
  const hit = Object.keys(pages).find((p) => path === p || path.startsWith(`${p}/`));
  return hit ? pages[hit] : (PAGES.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? "watch");
}

// Kept up to date from routes/app.tsx, which checks the shop's plan on every page.
export async function rememberTier(shop: string, tier: Tier | null) {
  const row = await db.shopPlan.findUnique({ where: { shop }, select: { tier: true } });
  if (row && row.tier === tier) return;
  await db.shopPlan.upsert({ where: { shop }, create: { shop, tier }, update: { tier } });
}

// Shops allowed more competitors through the COMPETITOR_LIMITS setting, as shop:limit pairs.
// 7fa72e-da is Dye Sub Supplies, on its own private copy (shopify.app.dss.toml).
const ENV_COMPETITORS = () =>
  new Map(
    (process.env.COMPETITOR_LIMITS ?? "7fa72e-da.myshopify.com:20")
      .split(",")
      .map((pair) => pair.split(":").map((s) => s.trim()))
      .filter(([shop, n]) => shop && Number(n) > 0)
      .map(([shop, n]) => [shop, Number(n)] as const),
  );

// How many of something a shop may have: its own limit if an admin set one,
// otherwise its plan's. Free shops get the top plan's.
export async function shopLimit(shop: string, key: LimitKey) {
  const [config, row] = await Promise.all([planConfig(), db.shopPlan.findUnique({ where: { shop } })]);
  const own = row?.[key];
  if (own != null) return own;
  if (key === "competitors") {
    const env = ENV_COMPETITORS().get(shop);
    if (env) return env;
  }
  const tier: Tier = isFreeShop(shop) ? "advertise" : isTier(row?.tier) ? row.tier : "watch";
  return config.limits[tier][key];
}

export async function setShopLimits(shop: string, limits: Partial<Record<LimitKey, number | null>>) {
  const data = Object.fromEntries(LIMITS.map((l) => [l.key, limits[l.key] ?? null]));
  await db.shopPlan.upsert({ where: { shop }, create: { shop, ...data }, update: data });
}

// Each plan's list for the plans page: its limits, for the pages it opens, then what it includes.
export async function planPackages() {
  const { limits, includes, pages } = await planConfig();
  const n = (x: number) => x.toLocaleString("en-GB");
  const lines = (t: Tier) =>
    LIMITS.filter((l) => covers(t, pages[l.page] ?? "watch")).map((l) => l.line.replace("#", n(limits[t][l.key])));
  return Object.fromEntries(TIERS.map((t) => [t, [...lines(t), ...includes[t]]])) as Record<Tier, string[]>;
}
