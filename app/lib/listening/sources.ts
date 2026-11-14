// The places social listening looks for mentions, shared by the server and the page.

export const SOURCES = [
  { key: "reddit", name: "Reddit" },
  { key: "youtube", name: "YouTube" },
  { key: "tiktok", name: "TikTok" },
  { key: "web", name: "Web and forums" },
] as const;
export type Source = (typeof SOURCES)[number]["key"];
