// The marketing channels a site is set up for, from the ad pixels and apps
// found on its storefront. Shared by the server and the Channels page.

export type Channel = "social" | "email" | "otherAds";

export const CHANNEL_LABEL: Record<Channel, string> = {
  social: "Social ads",
  email: "Email and SMS",
  otherAds: "Other ads",
};

const SHORT: Record<string, string> = {
  "Meta (Facebook & Instagram)": "Meta",
  "Microsoft Ads (Bing)": "Bing",
  "X (Twitter)": "X",
};

const GROUPS: Record<Channel, string[]> = {
  social: ["Meta (Facebook & Instagram)", "TikTok", "Pinterest", "Snapchat", "Reddit", "X (Twitter)"],
  email: ["Klaviyo", "Omnisend", "Mailchimp", "Attentive", "Postscript", "Privy"],
  otherAds: ["Microsoft Ads (Bing)", "Criteo"],
};

export function channelTools(adChannels: string[], apps: string[]): Record<Channel, string[]> {
  const seen = new Set([...adChannels, ...apps]);
  const pick = (names: string[]) => names.filter((n) => seen.has(n)).map((n) => SHORT[n] ?? n);
  return { social: pick(GROUPS.social), email: pick(GROUPS.email), otherAds: pick(GROUPS.otherAds) };
}
