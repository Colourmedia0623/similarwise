import { LINKEDIN, LINKEDIN_VERSION, graph, type Fetch } from "../social/networks.server";
import type { InboxNetwork, Kind } from "./inbox";

// Reading comments and messages from each network, and answering them.
//
// Facebook Pages: comments on the Page's recent posts (pages_read_engagement,
// pages_read_user_content for who wrote them) answered with
// pages_manage_engagement; Messenger conversations (pages_messaging), with
// replies after the 24-hour window sent with the human agent tag (human_agent),
// up to seven days.
// Instagram: comments on recent media (instagram_manage_comments), and
// direct messages through the linked Page (instagram_manage_messages).
// LinkedIn: comments on posts sent from SimilarWise (r_member_social, which
// needs LinkedIn's Community Management API).

export type Message = { remoteId: string; fromUs: boolean; author: string; text: string; at: Date };

// A conversation as the network gives it: a DM thread, or a comment with its replies.
export type Conversation = {
  kind: Kind;
  remoteId: string;
  contactId: string | null;
  contactName: string;
  post?: { id: string; url: string | null; text: string | null };
  messages: Message[];
};

export type InboxAccount = { network: InboxNetwork; accountId: string; token: string };

const DAY = 86400_000;
const date = (s: string | number | undefined) => (s == null ? new Date(0) : new Date(s));

type From = { id?: string; name?: string; username?: string };
type FbComment = { id: string; message?: string; created_time?: string; from?: From; comments?: { data?: FbComment[] } };
type FbPost = { id: string; message?: string; permalink_url?: string; comments?: { data?: FbComment[] } };
type IgComment = { id: string; text?: string; timestamp?: string; username?: string; from?: From; replies?: { data?: IgComment[] } };
type IgMedia = { id: string; caption?: string; permalink?: string; comments?: { data?: IgComment[] } };
type Conv = { id: string; updated_time?: string; participants?: { data?: From[] }; messages?: { data?: { id: string; message?: string; created_time?: string; from?: From }[] } };

const COMMENT = "id,message,created_time,from{id,name}";

async function facebookComments(f: Fetch, pageId: string, token: string, now: Date): Promise<Conversation[]> {
  const since = Math.floor((now.getTime() - 30 * DAY) / 1000);
  const fields = `id,message,permalink_url,comments.limit(50){${COMMENT},comments.limit(50){${COMMENT}}}`;
  const feed = await graph<{ data?: FbPost[] }>(f, `/${pageId}/feed`, { fields, since: String(since), limit: "25", access_token: token });
  const out: Conversation[] = [];
  for (const post of feed.data ?? []) {
    for (const c of post.comments?.data ?? []) {
      if (c.from?.id === pageId) continue;
      const name = c.from?.name || "Facebook user";
      const msg = (m: FbComment): Message => ({ remoteId: m.id, fromUs: m.from?.id === pageId, author: m.from?.id === pageId ? "You" : m.from?.name || "Facebook user", text: m.message ?? "", at: date(m.created_time) });
      out.push({
        kind: "comment",
        remoteId: c.id,
        contactId: c.from?.id ?? null,
        contactName: name,
        post: { id: post.id, url: post.permalink_url ?? null, text: post.message?.slice(0, 500) ?? null },
        messages: [c, ...(c.comments?.data ?? [])].map(msg),
      });
    }
  }
  return out;
}

async function instagramComments(f: Fetch, igId: string, token: string): Promise<Conversation[]> {
  const c = "id,text,timestamp,username,from{id,username}";
  const media = await graph<{ data?: IgMedia[] }>(f, `/${igId}/media`, { fields: `id,caption,permalink,comments.limit(50){${c},replies.limit(50){${c}}}`, limit: "25", access_token: token });
  const out: Conversation[] = [];
  for (const m of media.data ?? []) {
    for (const top of m.comments?.data ?? []) {
      const who = (x: IgComment) => x.from?.username ?? x.username;
      const ours = (x: IgComment) => x.from?.id === igId;
      if (ours(top)) continue;
      const msg = (x: IgComment): Message => ({ remoteId: x.id, fromUs: ours(x), author: ours(x) ? "You" : who(x) ? `@${who(x)}` : "Instagram user", text: x.text ?? "", at: date(x.timestamp) });
      out.push({
        kind: "comment",
        remoteId: top.id,
        contactId: top.from?.id ?? null,
        contactName: who(top) ? `@${who(top)}` : "Instagram user",
        post: { id: m.id, url: m.permalink ?? null, text: m.caption?.slice(0, 500) ?? null },
        messages: [top, ...(top.replies?.data ?? [])].map(msg),
      });
    }
  }
  return out;
}

// Messenger or Instagram conversations, read through the Page's token.
async function conversations(f: Fetch, platform: "messenger" | "instagram", selfId: string, token: string): Promise<Conversation[]> {
  const fields = "id,updated_time,participants,messages.limit(25){id,message,created_time,from}";
  const res = await graph<{ data?: Conv[] }>(f, "/me/conversations", { platform, fields, limit: "25", access_token: token });
  const fallback = platform === "instagram" ? "Instagram user" : "Facebook user";
  const name = (p: From | undefined) => (p?.username ? `@${p.username}` : p?.name || fallback);
  return (res.data ?? []).flatMap((c) => {
    const them = (c.participants?.data ?? []).find((p) => p.id !== selfId);
    if (!them?.id) return [];
    const messages = (c.messages?.data ?? [])
      .map((m) => ({ remoteId: m.id, fromUs: m.from?.id === selfId, author: m.from?.id === selfId ? "You" : name(m.from ?? them), text: m.message ?? "", at: date(m.created_time) }))
      .reverse();
    return [{ kind: "message" as const, remoteId: c.id, contactId: them.id, contactName: name(them), messages }];
  });
}

type LiComment = { id?: string; commentUrn?: string; $URN?: string; actor?: string; message?: { text?: string }; created?: { time?: number } };

async function linkedinGet<T>(f: Fetch, token: string, path: string): Promise<T> {
  const res = await f(`${LINKEDIN}/rest${path}`, {
    headers: { authorization: `Bearer ${token}`, "linkedin-version": LINKEDIN_VERSION(), "x-restli-protocol-version": "2.0.0" },
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(json.message || `LinkedIn answered ${res.status}`);
  return json;
}

const liUrn = (c: LiComment) => c.commentUrn ?? c.$URN ?? c.id ?? "";

// Comments on the member's posts that went out from SimilarWise. LinkedIn
// doesn't give commenters' names without partner access.
async function linkedinComments(f: Fetch, memberId: string, token: string, posts: { remoteId: string; url: string | null; text: string }[]): Promise<Conversation[]> {
  const self = `urn:li:person:${memberId}`;
  const out: Conversation[] = [];
  for (const p of posts) {
    const res = await linkedinGet<{ elements?: LiComment[] }>(f, token, `/socialActions/${encodeURIComponent(p.remoteId)}/comments?count=50`);
    for (const c of res.elements ?? []) {
      if (c.actor === self || !liUrn(c)) continue;
      const replies = await linkedinGet<{ elements?: LiComment[] }>(f, token, `/socialActions/${encodeURIComponent(liUrn(c))}/comments?count=50`).catch(() => ({ elements: [] as LiComment[] }));
      const msg = (m: LiComment): Message => ({ remoteId: liUrn(m), fromUs: m.actor === self, author: m.actor === self ? "You" : "LinkedIn member", text: m.message?.text ?? "", at: date(m.created?.time) });
      out.push({
        kind: "comment",
        remoteId: liUrn(c),
        contactId: c.actor ?? null,
        contactName: "LinkedIn member",
        post: { id: p.remoteId, url: p.url, text: p.text.slice(0, 500) },
        messages: [c, ...(replies.elements ?? [])].map(msg),
      });
    }
  }
  return out;
}

// Everything new enough to show for one account. LinkedIn needs the posts sent from SimilarWise.
export async function readInbox(a: InboxAccount, { f = fetch, now = new Date(), posts = [] }: { f?: Fetch; now?: Date; posts?: { remoteId: string; url: string | null; text: string }[] } = {}): Promise<Conversation[]> {
  if (a.network === "facebook") return [...(await facebookComments(f, a.accountId, a.token, now)), ...(await conversations(f, "messenger", a.accountId, a.token))];
  if (a.network === "instagram") return [...(await instagramComments(f, a.accountId, a.token)), ...(await conversations(f, "instagram", a.accountId, a.token))];
  return linkedinComments(f, a.accountId, a.token, posts);
}

export type Reply = { kind: Kind; remoteId: string; contactId: string | null; postId: string | null; text: string; lastTheirsAt: Date | null };

// Sends a reply and gives the network's id for it. A direct message more
// than 24 hours after their last one goes with Meta's human agent tag, which
// allows seven days.
export async function sendReply(a: InboxAccount, r: Reply, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}): Promise<string> {
  if (a.network === "linkedin") {
    const res = await f(`${LINKEDIN}/rest/socialActions/${encodeURIComponent(r.remoteId)}/comments`, {
      method: "POST",
      headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json", "linkedin-version": LINKEDIN_VERSION(), "x-restli-protocol-version": "2.0.0" },
      body: JSON.stringify({ actor: `urn:li:person:${a.accountId}`, object: r.postId, parentComment: r.remoteId, message: { text: r.text } }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as LiComment & { message?: string | { text?: string } };
    if (!res.ok) throw new Error((typeof json.message === "string" && json.message) || `LinkedIn answered ${res.status}`);
    return res.headers.get("x-restli-id") || liUrn(json) || `sent-${now.getTime()}`;
  }
  if (r.kind === "comment") {
    const path = a.network === "instagram" ? `/${r.remoteId}/replies` : `/${r.remoteId}/comments`;
    const done = await graph<{ id: string }>(f, path, { message: r.text, access_token: a.token }, "POST");
    return done.id;
  }
  if (!r.contactId) throw new Error("There's no one to send this to.");
  const since = r.lastTheirsAt ? now.getTime() - r.lastTheirsAt.getTime() : 0;
  if (since > 7 * DAY) throw new Error("It's been more than seven days since their last message, so Meta won't let a reply through. It'll open again when they write.");
  const window: Record<string, string> = since > DAY ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" };
  const done = await graph<{ message_id?: string }>(f, "/me/messages", { recipient: JSON.stringify({ id: r.contactId }), message: JSON.stringify({ text: r.text }), ...window, access_token: a.token }, "POST");
  return done.message_id ?? `sent-${now.getTime()}`;
}

// Words in a network's error that mean a permission wasn't given.
export const permissionError = (message: string) => /permission|scope|\(#10\)|\(#200\)|\(#230\)|not authori[sz]ed|access_denied|ACCESS_DENIED/i.test(message);
