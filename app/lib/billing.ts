// The three SimilarWise plans, which pages each one opens, and what they cost.
// Shared by the server billing config and the plans page.

export type Tier = "watch" | "grow" | "advertise";
export type Cycle = "monthly" | "yearly";

export const TRIAL_DAYS = 7;

export const PLANS: { tier: Tier; name: string; blurb: string; monthly: number; yearly: number; includes: string[] }[] = [
  {
    tier: "watch",
    name: "Watch",
    blurb: "Keep an eye on the stores you compete with.",
    monthly: 69,
    yearly: 49,
    includes: ["Competitor tracking and alerts", "Similar sites", "Price comparison", "Website technologies", "Traffic and engagement", "Marketing channels"],
  },
  {
    tier: "grow",
    name: "Grow",
    blurb: "Win more search traffic, from Google and AI answers.",
    monthly: 189,
    yearly: 149,
    includes: ["Everything in Watch", "Keyword gap and keyword ideas", "Weekly SEO site audit", "AI mentions", "Blog articles and content calendar", "Link gap and outreach emails"],
  },
  {
    tier: "advertise",
    name: "Advertise",
    blurb: "See competitors' ads and publish your own content everywhere.",
    monthly: 339,
    yearly: 269,
    includes: ["Everything in Grow", "Competitor ads", "Ad ideas", "Sharing to Facebook, Instagram and TikTok"],
  },
];

const RANK: Record<Tier, number> = { watch: 0, grow: 1, advertise: 2 };

// Billing plan names as Shopify shows them on the charge, such as "Grow (yearly)".
export const planKey = (tier: Tier, cycle: Cycle) => `${PLANS.find((p) => p.tier === tier)!.name} (${cycle})`;
export const PLAN_KEYS = PLANS.flatMap((p) => [planKey(p.tier, "monthly"), planKey(p.tier, "yearly")]);

export function parsePlanKey(key: string): { tier: Tier; cycle: Cycle } | null {
  for (const p of PLANS) for (const cycle of ["monthly", "yearly"] as const) if (planKey(p.tier, cycle) === key) return { tier: p.tier, cycle };
  return null;
}

// The plan each page needs. Pages not listed (overview, email alerts, plans) are open on any plan.
const PAGES: [string, Tier][] = [
  ["/app/keywords", "grow"],
  ["/app/audit", "grow"],
  ["/app/ai", "grow"],
  ["/app/ideas", "grow"],
  ["/app/articles", "grow"],
  ["/app/calendar", "grow"],
  ["/app/links", "grow"],
  ["/app/outreach", "grow"],
  ["/app/ads", "advertise"],
  ["/app/ad-ideas", "advertise"],
  ["/app/social", "advertise"],
];

export function pageTier(path: string): Tier {
  const hit = PAGES.find(([p]) => path === p || path.startsWith(`${p}/`));
  return hit ? hit[1] : "watch";
}

export const covers = (have: Tier, need: Tier) => RANK[have] >= RANK[need];
