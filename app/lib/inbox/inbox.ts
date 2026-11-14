import type { Network } from "../social/networks";

// The social inbox, for the server and the page.

// The networks whose comments and messages can be read and answered. TikTok
// and Pinterest don't let apps like SimilarWise read comments or messages.
export const INBOX_NETWORKS = ["facebook", "instagram", "linkedin"] as const satisfies readonly Network[];
export type InboxNetwork = (typeof INBOX_NETWORKS)[number];
export const isInboxNetwork = (n: string): n is InboxNetwork => (INBOX_NETWORKS as readonly string[]).includes(n);

export type Kind = "comment" | "message";
export type Sentiment = "positive" | "neutral" | "negative";

export const KIND_NAME: Record<Kind, string> = { comment: "Comment", message: "Direct message" };

// Tags Claude may give a conversation, beside the shop's own.
export const STARTER_TAGS = ["order status", "returns", "delivery", "product question", "complaint", "praise", "pricing", "spam"];

// The longest reply each network takes.
export const REPLY_LIMIT: Record<InboxNetwork, number> = { facebook: 8000, instagram: 1000, linkedin: 1250 };

// A conversation waiting longer than this needs action, even if it has someone.
export const NEEDS_ACTION_AFTER = 3600_000;

// Fills in an automated reply: {name} is the person's first name.
export const fillReply = (text: string, contactName: string) => {
  const first = contactName.replace(/^@/, "").split(/[\s._]/)[0] || "there";
  const name = /^(facebook|instagram|linkedin) (user|member)$/i.test(contactName) ? "there" : first;
  return text.replace(/\{name\}/gi, name);
};

// Whether a message matches any of a rule's words or phrases, ignoring case.
// Single words match whole words, so "hi" doesn't match "this".
export function matchesWords(text: string, words: string[]) {
  if (!words.length) return true;
  const t = text.toLowerCase();
  return words.some((w) => {
    const word = w.trim().toLowerCase();
    if (!word) return false;
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "u").test(t);
  });
}
