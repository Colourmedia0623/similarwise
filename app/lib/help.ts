// The how-to video for each section of the app, in menu order. Videos live in
// public/how-to/<slug>.mp4, with a still from each as <slug>.jpg; seconds is
// each video's length.

export type HowTo = { slug: string; path: string; section: string; title: string; seconds: number };

export const HOW_TOS: HowTo[] = [
  { slug: "overview", path: "/app", section: "Overview", title: "Your Overview page", seconds: 55 },
  { slug: "competitors", path: "/app/competitors", section: "Competitors", title: "Track your competitors", seconds: 74 },
  { slug: "similar-sites", path: "/app/similar", section: "Similar sites", title: "Find similar sites", seconds: 50 },
  { slug: "price-comparison", path: "/app/prices", section: "Price comparison", title: "Compare your prices", seconds: 57 },
  { slug: "out-of-stock", path: "/app/stock", section: "Out of stock", title: "Spot out-of-stock products", seconds: 50 },
  { slug: "keyword-gap", path: "/app/keywords", section: "Keyword gap", title: "Find your keyword gap", seconds: 60 },
  { slug: "rank-tracker", path: "/app/ranks", section: "Rank tracker", title: "Track your Google rankings", seconds: 58 },
  { slug: "site-audit", path: "/app/audit", section: "Site audit", title: "Run a site audit", seconds: 49 },
  { slug: "ai-mentions", path: "/app/ai", section: "AI mentions", title: "Check your AI mentions", seconds: 64 },
  { slug: "keyword-ideas", path: "/app/ideas", section: "Keyword ideas", title: "Get keyword ideas", seconds: 54 },
  { slug: "blog-articles", path: "/app/articles", section: "Blog articles", title: "Publish blog articles", seconds: 58 },
  { slug: "content-calendar", path: "/app/calendar", section: "Content calendar", title: "Plan your content calendar", seconds: 61 },
  { slug: "link-gap", path: "/app/links", section: "Link gap", title: "Close your link gap", seconds: 45 },
  { slug: "outreach-emails", path: "/app/outreach", section: "Outreach emails", title: "Send outreach emails", seconds: 60 },
  { slug: "social-listening", path: "/app/listening", section: "Social listening", title: "Use social listening", seconds: 70 },
  { slug: "social-calendar", path: "/app/publishing", section: "Social calendar", title: "Use the social calendar", seconds: 97 },
  { slug: "social-accounts", path: "/app/social", section: "Social accounts", title: "Connect your social accounts", seconds: 51 },
  { slug: "paid-social-ads", path: "/app/paid-social", section: "Paid social ads", title: "Manage your paid social ads", seconds: 61 },
  { slug: "website-technologies", path: "/app/tech", section: "Website technologies", title: "See the apps your competitors use", seconds: 58 },
  { slug: "traffic-and-engagement", path: "/app/traffic", section: "Traffic and engagement", title: "Compare your traffic", seconds: 52 },
  { slug: "marketing-channels", path: "/app/channels", section: "Marketing channels", title: "See where their visits come from", seconds: 55 },
  { slug: "google-analytics-and-ads", path: "/app/google", section: "Google Analytics and Ads", title: "Connect Google Analytics and Ads", seconds: 74 },
  { slug: "ads", path: "/app/ads", section: "Ads", title: "See your competitors' ads", seconds: 57 },
  { slug: "ad-ideas", path: "/app/ad-ideas", section: "Ad ideas", title: "Get ad ideas", seconds: 49 },
  { slug: "settings", path: "/app/settings", section: "Settings", title: "Set up your alerts", seconds: 47 },
  { slug: "plans", path: "/app/plans", section: "Plans", title: "Choose your plan", seconds: 41 },
];

export const howTo = (slug: string) => HOW_TOS.find((h) => h.slug === slug) ?? null;

export const videoLength = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
