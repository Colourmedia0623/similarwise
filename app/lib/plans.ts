import type { Tier } from "./billing";

// What a plan can include, shared by the server (plans.server.ts) and Admin → Packages.

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
  { path: "/app/product-seo", label: "Product SEO" },
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
