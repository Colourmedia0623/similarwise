// Where a website's visits come from, grouped the way the Channels page shows
// them. Shared by the server and the page.

export const SOURCES = ["direct", "search", "paidSearch", "social", "referrals", "email", "display", "other"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  direct: "Direct",
  search: "Organic search",
  paidSearch: "Paid search",
  social: "Social",
  referrals: "Referrals",
  email: "Email",
  display: "Display ads",
  other: "AI and affiliates",
};

export type Shares = Partial<Record<Source, number>>;
