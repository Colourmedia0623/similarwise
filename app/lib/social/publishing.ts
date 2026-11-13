import type { Network } from "./networks";

// Limits and colours for the social calendar, shared by the server and the page.

// The longest caption each network takes.
export const LIMITS: Record<Network, number> = { facebook: 63206, instagram: 2200, tiktok: 4000, pinterest: 800 };

export const CAMPAIGN_COLORS = ["#6d4aff", "#e8590c", "#0c8599", "#d6336c", "#2f9e44", "#1971c2", "#f08c00", "#495057"];

// The most pictures a post can carry: Instagram's carousel limit.
export const MAX_PICTURES = 10;
