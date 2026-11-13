// The social networks articles can be shared to, for the server and the pages.

export type Network = "facebook" | "instagram" | "tiktok" | "pinterest";

export const NETWORK_NAME: Record<Network, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", pinterest: "Pinterest" };

// How a sent post is doing, as far as its network tells. Missing figures are
// ones the network doesn't give, or SimilarWise isn't allowed to read yet.
export type PostStats = { likes?: number; comments?: number; shares?: number; saves?: number; reach?: number; clicks?: number };
