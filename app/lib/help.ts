// The how-to video for each section of the app, in menu order. Videos live in
// public/how-to/<slug>.mp4.

export type HowTo = { slug: string; path: string; section: string; title: string };

export const HOW_TOS: HowTo[] = [
  { slug: "overview", path: "/app", section: "Overview", title: "Your Overview page" },
  { slug: "competitors", path: "/app/competitors", section: "Competitors", title: "Track your competitors" },
  { slug: "similar-sites", path: "/app/similar", section: "Similar sites", title: "Find similar sites" },
  { slug: "price-comparison", path: "/app/prices", section: "Price comparison", title: "Compare your prices" },
  { slug: "out-of-stock", path: "/app/stock", section: "Out of stock", title: "Spot out-of-stock products" },
  { slug: "keyword-gap", path: "/app/keywords", section: "Keyword gap", title: "Find your keyword gap" },
  { slug: "rank-tracker", path: "/app/ranks", section: "Rank tracker", title: "Track your Google rankings" },
  { slug: "site-audit", path: "/app/audit", section: "Site audit", title: "Run a site audit" },
  { slug: "ai-mentions", path: "/app/ai", section: "AI mentions", title: "Check your AI mentions" },
  { slug: "keyword-ideas", path: "/app/ideas", section: "Keyword ideas", title: "Get keyword ideas" },
  { slug: "blog-articles", path: "/app/articles", section: "Blog articles", title: "Publish blog articles" },
  { slug: "content-calendar", path: "/app/calendar", section: "Content calendar", title: "Plan your content calendar" },
  { slug: "link-gap", path: "/app/links", section: "Link gap", title: "Close your link gap" },
  { slug: "outreach-emails", path: "/app/outreach", section: "Outreach emails", title: "Send outreach emails" },
  { slug: "social-listening", path: "/app/listening", section: "Social listening", title: "Use social listening" },
  { slug: "social-calendar", path: "/app/publishing", section: "Social calendar", title: "Use the social calendar" },
  { slug: "social-accounts", path: "/app/social", section: "Social accounts", title: "Connect your social accounts" },
  { slug: "paid-social-ads", path: "/app/paid-social", section: "Paid social ads", title: "Manage your paid social ads" },
  { slug: "website-technologies", path: "/app/tech", section: "Website technologies", title: "See the apps your competitors use" },
  { slug: "traffic-and-engagement", path: "/app/traffic", section: "Traffic and engagement", title: "Compare your traffic" },
  { slug: "marketing-channels", path: "/app/channels", section: "Marketing channels", title: "See where their visits come from" },
  { slug: "google-analytics-and-ads", path: "/app/google", section: "Google Analytics and Ads", title: "Connect Google Analytics and Ads" },
  { slug: "ads", path: "/app/ads", section: "Ads", title: "See your competitors' ads" },
  { slug: "ad-ideas", path: "/app/ad-ideas", section: "Ad ideas", title: "Get ad ideas" },
  { slug: "settings", path: "/app/settings", section: "Settings", title: "Set up your alerts" },
  { slug: "plans", path: "/app/plans", section: "Plans", title: "Choose your plan" },
];

export const howTo = (slug: string) => HOW_TOS.find((h) => h.slug === slug) ?? null;
