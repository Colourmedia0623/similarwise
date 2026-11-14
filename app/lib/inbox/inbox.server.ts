import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import { isFreeShop } from "../waitlist.server";
import { NETWORK_NAME, postLink, type Fetch } from "../social/networks.server";
import { liveToken } from "../social/social.server";
import { INBOX_NETWORKS, NEEDS_ACTION_AFTER, REPLY_LIMIT, STARTER_TAGS, fillReply, isInboxNetwork, matchesWords, type InboxNetwork, type Kind, type Sentiment } from "./inbox";
import { permissionError, readInbox, sendReply, type Conversation } from "./networks.server";

// The social inbox: comments on the shop's posts and its direct messages from
// every connected Facebook Page, Instagram account and LinkedIn profile, in
// one place. Read every five minutes (syncAllInboxes); Claude reads each new
// message for how it feels and what it's about; the shop's automations tag,
// route, answer and resolve; and the team answers, assigns and resolves the rest.

// Each network's inbox needs its own approval from that network, separate
// from posting, so it stays hidden until INBOX_APPROVED lists it, e.g.
// "facebook,instagram". Colourmedia's own and free stores (people added to
// the Meta app) can use Facebook and Instagram before then. LinkedIn's
// permission can't be tried before it's granted, so it waits for the list.
export const inboxApproved = (n: InboxNetwork) => (process.env.INBOX_APPROVED ?? "").split(",").map((s) => s.trim()).includes(n);
export const inboxOpen = (shop: string, n: string): n is InboxNetwork => isInboxNetwork(n) && (inboxApproved(n) || (isFreeShop(shop) && n !== "linkedin"));
export const openNetworks = (shop: string) => INBOX_NETWORKS.filter((n) => inboxOpen(shop, n));

const list = (s: string | null | undefined): string[] => {
  try {
    const v = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const clean = (xs: string[], max = 20) => [...new Set(xs.map((x) => x.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, max);

type Account = { id: string; shop: string; network: string; accountId: string; token: string; refreshToken: string | null; tokenExpiresAt: Date | null; inboxSyncedAt: Date | null };
type Opts = { f?: Fetch; now?: Date; ask?: AskJson | null };
// A conversation with new messages from the person, and what they said.
type Fresh = { id: string; text: string };

// Reads one account's comments and messages, saves what's new, and gives
// the conversations with new messages from people since the last read. The
// first read brings in what's there without running automations on it.
export async function syncAccount(account: Account, { f = fetch, now = new Date() }: Opts = {}) {
  const network = account.network as InboxNetwork;
  const first = !account.inboxSyncedAt;
  const refused = (message: string) =>
    permissionError(message) ? `Connect ${network === "linkedin" ? "LinkedIn" : "Facebook and Instagram"} again in Social accounts and allow them. ${NETWORK_NAME[network]} said: ${message}` : `${NETWORK_NAME[network]} said: ${message}`;
  let found: Conversation[];
  let partial: string | null = null;
  try {
    const token = await liveToken(account, f, now);
    const posts =
      network === "linkedin"
        ? (
            await db.socialPost.findMany({
              where: { shop: account.shop, accountId: account.id, status: "posted", remoteId: { not: null }, createdAt: { gt: new Date(now.getTime() - 60 * 86400_000) } },
              orderBy: { createdAt: "desc" },
              take: 20,
            })
          ).map((p) => ({ remoteId: p.remoteId!, url: postLink(p), text: p.caption }))
        : [];
    const read = await readInbox({ network, accountId: account.accountId, token }, { f, now, posts });
    const what = (part: string) => (part === "messages" ? "direct messages" : "comments");
    if (read.failed.length && !read.conversations.length && read.failed.length === (network === "linkedin" ? 1 : 2)) {
      const m = read.failed[0].message;
      throw new Error(read.failed.length > 1 && read.failed[1].message !== m ? `${m} / ${read.failed[1].message}` : m);
    }
    // One part refused: show the rest, and say which part is missing and why.
    partial = read.failed.length ? `${NETWORK_NAME[network]} hasn't let SimilarWise read ${read.failed.map((x) => what(x.part)).join(" or ")} yet. ${refused(read.failed[0].message)}` : null;
    found = read.conversations;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = permissionError(message) ? `${NETWORK_NAME[network]} hasn't let SimilarWise read comments and messages yet. ${refused(message)}` : refused(message);
    await db.socialAccount.update({ where: { id: account.id }, data: { inboxError: error.slice(0, 400) } });
    return { error, fresh: [] as Fresh[] };
  }

  const fresh: Fresh[] = [];
  for (const c of found) {
    if (!c.messages.length) continue;
    let thread = await db.inboxThread.findUnique({ where: { accountId_remoteId: { accountId: account.id, remoteId: c.remoteId } } });
    const known = new Set(thread ? (await db.inboxMessage.findMany({ where: { threadId: thread.id }, select: { remoteId: true } })).map((m) => m.remoteId) : []);
    const added = c.messages.filter((m) => m.remoteId && !known.has(m.remoteId));
    if (!added.length && thread) continue;
    if (!thread) {
      const last = c.messages[c.messages.length - 1];
      thread = await db.inboxThread.create({
        data: {
          shop: account.shop,
          accountId: account.id,
          network,
          kind: c.kind,
          remoteId: c.remoteId,
          contactId: c.contactId,
          contactName: c.contactName.slice(0, 200),
          postId: c.post?.id ?? null,
          postUrl: c.post?.url ?? null,
          postText: c.post?.text ?? null,
          lastAt: last.at,
          // Already answered before it came in: nothing to do.
          status: last.fromUs ? "resolved" : "open",
          resolvedAt: last.fromUs ? now : null,
          read: last.fromUs,
        },
      });
    }
    for (const m of added)
      await db.inboxMessage.create({
        data: { shop: account.shop, threadId: thread.id, remoteId: m.remoteId, fromUs: m.fromUs, author: m.author.slice(0, 200), text: (m.text || "(a picture, sticker or attachment)").slice(0, 8000), at: m.at },
      });
    const theirsNew = added.filter((m) => !m.fromUs && (!account.inboxSyncedAt || m.at > account.inboxSyncedAt));
    await settle(thread.id, theirsNew.length > 0 && thread.status === "resolved" ? { status: "open", resolvedAt: null } : {});
    if (theirsNew.length) {
      await db.inboxThread.update({ where: { id: thread.id }, data: { read: false, ...(c.contactName && c.contactName !== thread.contactName ? { contactName: c.contactName.slice(0, 200) } : {}) } });
      if (!first) fresh.push({ id: thread.id, text: theirsNew.map((m) => m.text).join("\n") });
    }
  }
  await db.socialAccount.update({ where: { id: account.id }, data: { inboxSyncedAt: now, inboxError: partial?.slice(0, 400) ?? null } });
  return { fresh };
}

// Brings a conversation's summary up to date with its messages: the latest
// one, and how long they've been waiting for an answer.
async function settle(threadId: string, extra: { status?: string; resolvedAt?: Date | null } = {}) {
  const messages = await db.inboxMessage.findMany({ where: { threadId }, orderBy: { at: "asc" } });
  const last = messages[messages.length - 1];
  if (!last) return;
  const lastOurs = messages.reduce((i, m, k) => (m.fromUs ? k : i), -1);
  const waiting = messages.slice(lastOurs + 1).find((m) => !m.fromUs);
  await db.inboxThread.update({
    where: { id: threadId },
    data: { lastText: last.text.slice(0, 500), lastAt: last.at, lastFrom: last.fromUs ? "us" : "them", waitingSince: waiting?.at ?? null, ...extra },
  });
}

// Reads every open account of the shop, then lets Claude and the automations
// at what came in.
export async function syncShop(shop: string, opts: Opts = {}) {
  const accounts = (await db.socialAccount.findMany({ where: { shop } })).filter((a) => inboxOpen(shop, a.network));
  const fresh: Fresh[] = [];
  for (const a of accounts) fresh.push(...(await syncAccount(a, opts)).fresh);
  await readNew(shop, opts.ask === undefined ? claudeJson() : opts.ask).catch((err) => console.error("Couldn't read new inbox messages", shop, err));
  await automate(shop, fresh, opts);
  await route(shop, fresh.map((x) => x.id));
  return { accounts: accounts.length, fresh: fresh.length };
}

let syncing = false;

// Every shop with an open inbox account, from the scheduler.
export async function syncAllInboxes(opts: Opts = {}) {
  if (syncing) return;
  syncing = true;
  try {
    const shops = [...new Set((await db.socialAccount.findMany({ where: { network: { in: [...INBOX_NETWORKS] } }, select: { shop: true, network: true } })).filter((a) => inboxOpen(a.shop, a.network)).map((a) => a.shop))];
    for (const shop of shops) await syncShop(shop, opts).catch((err) => console.error("Couldn't read the social inbox", shop, err));
  } finally {
    syncing = false;
  }
}

const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["conversations"],
  properties: {
    conversations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "sentiment", "tags"],
        properties: { id: { type: "string" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, tags: { type: "array", items: { type: "string" } } },
      },
    },
  },
};

const READ_SYSTEM = `You help a small online shop's team with its social media inbox: comments on its posts and direct messages. For each conversation, say how the person's latest messages feel (positive, neutral or negative, about the shop or their experience), and give it 1 to 3 short lowercase tags for what it's about. Use the shop's tags when they fit, and only make a new one when none does. Tag obvious spam, bots and scams "spam".`;

// The tags in use: the starter ones, teammates' skills, the automations' and any already given.
async function tagWords(shop: string) {
  const [members, rules, threads] = await Promise.all([
    db.inboxMember.findMany({ where: { shop }, select: { skills: true } }),
    db.inboxRule.findMany({ where: { shop }, select: { addTags: true } }),
    db.inboxThread.findMany({ where: { shop, tags: { not: "[]" } }, select: { tags: true }, orderBy: { lastAt: "desc" }, take: 300 }),
  ]);
  return clean([...STARTER_TAGS, ...members.flatMap((m) => list(m.skills)), ...rules.flatMap((r) => list(r.addTags)), ...threads.flatMap((t) => list(t.tags))], 60);
}

// Claude's read of the conversations with messages it hasn't seen: how they feel and what they're about.
export async function readNew(shop: string, ask: AskJson | null) {
  const threads = await db.inboxThread.findMany({ where: { shop, read: false }, orderBy: { lastAt: "desc" }, take: 40 });
  if (!threads.length) return 0;
  if (!ask) {
    await db.inboxThread.updateMany({ where: { id: { in: threads.map((t) => t.id) } }, data: { read: true } });
    return 0;
  }
  const messages = await db.inboxMessage.findMany({ where: { threadId: { in: threads.map((t) => t.id) } }, orderBy: { at: "asc" } });
  const input = {
    tags: await tagWords(shop),
    conversations: threads.map((t) => ({
      id: t.id,
      network: t.network,
      kind: t.kind,
      post: t.postText?.slice(0, 300) ?? null,
      messages: messages
        .filter((m) => m.threadId === t.id)
        .slice(-6)
        .map((m) => ({ from: m.fromUs ? "shop" : "customer", text: m.text.slice(0, 600) })),
    })),
  };
  const out = (await ask(READ_SYSTEM, input, READ_SCHEMA)) as { conversations?: { id: string; sentiment: Sentiment; tags: string[] }[] } | null;
  for (const t of threads) {
    const r = out?.conversations?.find((c) => c.id === t.id);
    const sentiment = r && ["positive", "neutral", "negative"].includes(r.sentiment) ? r.sentiment : t.sentiment;
    await db.inboxThread.update({ where: { id: t.id }, data: { read: true, sentiment, tags: JSON.stringify(clean([...list(t.tags), ...(r?.tags ?? []).slice(0, 3)], 8)) } });
  }
  return threads.length;
}

// Runs the shop's automations, in order, on conversations with new messages,
// matching what the person has just said.
// Each rule that matches adds its tags, gives the conversation to its
// teammate if no one has it, answers (once per conversation) and resolves.
export async function automate(shop: string, fresh: Fresh[], { f = fetch, now = new Date() }: Opts = {}) {
  if (!fresh.length) return 0;
  const rules = await db.inboxRule.findMany({ where: { shop, on: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  if (!rules.length) return 0;
  let acted = 0;
  for (const { id, text } of fresh) {
    const t = await db.inboxThread.findUnique({ where: { id } });
    if (!t) continue;
    let tags = list(t.tags);
    let assignee = t.assignee;
    let resolve = false;
    const replied = list(t.autoReplied);
    for (const r of rules) {
      const networks = list(r.networks);
      const kinds = list(r.kinds);
      if (networks.length && !networks.includes(t.network)) continue;
      if (kinds.length && !kinds.includes(t.kind)) continue;
      if (r.sentiment && r.sentiment !== t.sentiment) continue;
      if (!matchesWords(text, list(r.words))) continue;
      acted++;
      tags = clean([...tags, ...list(r.addTags)], 8);
      if (r.assignTo && !assignee) assignee = r.assignTo;
      if (r.reply?.trim() && !replied.includes(r.id)) {
        const sent = await answer(shop, id, fillReply(r.reply, t.contactName), { f, now, auto: true });
        if ("error" in sent) console.error("Couldn't send an automated reply", shop, id, sent.error);
        else replied.push(r.id);
      }
      if (r.resolve) resolve = true;
    }
    await db.inboxThread.update({
      where: { id },
      data: { tags: JSON.stringify(tags), assignee, autoReplied: JSON.stringify(replied), ...(resolve ? { status: "resolved", resolvedAt: now } : {}) },
    });
  }
  return acted;
}

// Gives open conversations no one has to a teammate who takes new ones:
// one whose skills match its tags, or else one who takes anything (no
// skills set), whoever has fewest open conversations.
export async function route(shop: string, threadIds: string[]) {
  if (!threadIds.length) return 0;
  const members = await db.inboxMember.findMany({ where: { shop, routing: true }, orderBy: { createdAt: "asc" } });
  if (!members.length) return 0;
  const load = new Map<string, number>();
  for (const g of await db.inboxThread.groupBy({ by: ["assignee"], where: { shop, status: "open", assignee: { not: null } }, _count: true })) load.set(g.assignee!, g._count);
  let routed = 0;
  for (const id of threadIds) {
    const t = await db.inboxThread.findUnique({ where: { id } });
    if (!t || t.assignee || t.status !== "open") continue;
    const tags = list(t.tags);
    const skilled = members.filter((m) => list(m.skills).some((s) => tags.includes(s)));
    const pool = skilled.length ? skilled : members.filter((m) => !list(m.skills).length);
    if (!pool.length) continue;
    const pick = [...pool].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
    await db.inboxThread.update({ where: { id }, data: { assignee: pick.id } });
    load.set(pick.id, (load.get(pick.id) ?? 0) + 1);
    routed++;
  }
  return routed;
}

// Sends an answer to a conversation from its account, and records it.
export async function answer(shop: string, threadId: string, raw: string, { f = fetch, now = new Date(), auto = false, by = null as string | null, resolve = false } = {}) {
  const text = raw.trim();
  const t = await db.inboxThread.findFirst({ where: { id: threadId, shop } });
  if (!t) return { error: "That conversation isn't there any more." };
  if (!text) return { error: "Write a reply first." };
  const network = t.network as InboxNetwork;
  if (!inboxOpen(shop, network)) return { error: `Answering on ${NETWORK_NAME[network]} isn't open yet.` };
  if (text.length > REPLY_LIMIT[network]) return { error: `${NETWORK_NAME[network]} takes replies up to ${REPLY_LIMIT[network]} characters.` };
  const account = await db.socialAccount.findFirst({ where: { id: t.accountId, shop } });
  if (!account) return { error: `The ${NETWORK_NAME[network]} account this came to isn't connected any more.` };
  const lastTheirs = await db.inboxMessage.findFirst({ where: { threadId, fromUs: false }, orderBy: { at: "desc" } });
  // Meta's human agent tag is only for replies a person writes.
  if (auto && t.kind === "message" && lastTheirs && now.getTime() - lastTheirs.at.getTime() > 86400_000) return { error: "Too late for an automated reply." };
  try {
    const token = await liveToken(account, f, now);
    const remoteId = await sendReply(
      { network, accountId: account.accountId, token },
      { kind: t.kind as Kind, remoteId: t.remoteId, contactId: t.contactId, postId: t.postId, text, lastTheirsAt: lastTheirs?.at ?? null },
      { f, now },
    );
    await db.inboxMessage.create({ data: { shop, threadId, remoteId, fromUs: true, author: "You", text, at: now, auto, sentBy: by } });
    await settle(threadId, resolve ? { status: "resolved", resolvedAt: now } : {});
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (permissionError(message)) return { error: `${NETWORK_NAME[network]} hasn't let SimilarWise answer yet. Connect the account again in Social accounts and allow it.` };
    return { error: `${NETWORK_NAME[network]} said: ${message}` };
  }
}

export async function setStatus(shop: string, ids: string[], status: "open" | "resolved", now = new Date()) {
  await db.inboxThread.updateMany({ where: { shop, id: { in: ids } }, data: { status, resolvedAt: status === "resolved" ? now : null } });
}

export async function assign(shop: string, ids: string[], memberId: string | null) {
  if (memberId && !(await db.inboxMember.findFirst({ where: { id: memberId, shop } }))) return { error: "That teammate isn't there any more." };
  await db.inboxThread.updateMany({ where: { shop, id: { in: ids } }, data: { assignee: memberId } });
  return { ok: true as const };
}

export async function setTags(shop: string, id: string, tags: string[]) {
  await db.inboxThread.updateMany({ where: { shop, id }, data: { tags: JSON.stringify(clean(tags, 8)) } });
}

const DRAFT_SCHEMA = { type: "object", additionalProperties: false, required: ["reply"], properties: { reply: { type: "string" } } };

// A reply Claude drafts for the team to check and send.
export async function draftReply(shop: string, threadId: string, ask: AskJson | null = claudeJson()) {
  if (!ask) return { error: "Suggested replies aren't switched on for this app yet." };
  const t = await db.inboxThread.findFirst({ where: { id: threadId, shop } });
  if (!t) return { error: "That conversation isn't there any more." };
  const messages = await db.inboxMessage.findMany({ where: { threadId }, orderBy: { at: "asc" } });
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const network = t.network as InboxNetwork;
  const out = (await ask(
    `You answer a small online shop's social media ${t.kind === "message" ? "direct messages" : "comments"} on ${NETWORK_NAME[network]}, as the shop. Write the next reply to the customer: warm, short (1 to 3 sentences), plain and helpful, in their language. Don't invent order details, prices, policies or promises; where you'd need those, ask for what you need or say the team will check. ${t.kind === "comment" ? "It's public, so ask them to send a direct message for anything personal like order numbers." : ""} At most one emoji. Under ${REPLY_LIMIT[network]} characters.`,
    { shop: settings?.aiBrand ?? shop.replace(/\.myshopify\.com$/, ""), post: t.postText, conversation: messages.slice(-12).map((m) => ({ from: m.fromUs ? "shop" : t.contactName, text: m.text.slice(0, 1000) })) },
    DRAFT_SCHEMA,
  )) as { reply?: string } | null;
  const reply = out?.reply?.trim();
  return reply ? { reply: reply.slice(0, REPLY_LIMIT[network]) } : { error: "Couldn't write a reply. Try again." };
}

// Teammates and automations.

export async function saveMember(shop: string, input: { id?: string; name: string; skills: string[]; routing: boolean }) {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { error: "Give the teammate a name." };
  const data = { name, skills: JSON.stringify(clean(input.skills)), routing: input.routing };
  if (input.id) await db.inboxMember.updateMany({ where: { id: input.id, shop }, data });
  else await db.inboxMember.create({ data: { shop, ...data } });
  return { ok: true as const };
}

export async function deleteMember(shop: string, id: string) {
  await db.inboxMember.deleteMany({ where: { id, shop } });
  await db.inboxThread.updateMany({ where: { shop, assignee: id }, data: { assignee: null } });
  await db.inboxRule.updateMany({ where: { shop, assignTo: id }, data: { assignTo: null } });
}

export type RuleInput = { id?: string; name: string; on: boolean; networks: string[]; kinds: string[]; words: string[]; sentiment: string; addTags: string[]; assignTo: string; reply: string; resolve: boolean };

export async function saveRule(shop: string, r: RuleInput) {
  const name = r.name.trim().slice(0, 80);
  if (!name) return { error: "Give the automation a name." };
  const reply = r.reply.trim().slice(0, 1000);
  const addTags = clean(r.addTags, 5);
  if (!reply && !addTags.length && !r.assignTo && !r.resolve) return { error: "Choose at least one thing for it to do." };
  if (r.assignTo && !(await db.inboxMember.findFirst({ where: { id: r.assignTo, shop } }))) return { error: "That teammate isn't there any more." };
  const data = {
    name,
    on: r.on,
    networks: JSON.stringify(r.networks.filter(isInboxNetwork)),
    kinds: JSON.stringify(r.kinds.filter((k) => k === "comment" || k === "message")),
    words: JSON.stringify([...new Set(r.words.map((w) => w.trim().slice(0, 60)).filter(Boolean))].slice(0, 30)),
    sentiment: ["positive", "neutral", "negative"].includes(r.sentiment) ? r.sentiment : null,
    addTags: JSON.stringify(addTags),
    assignTo: r.assignTo || null,
    reply: reply || null,
    resolve: r.resolve,
  };
  if (r.id) await db.inboxRule.updateMany({ where: { id: r.id, shop }, data });
  else await db.inboxRule.create({ data: { shop, ...data, position: await db.inboxRule.count({ where: { shop } }) } });
  return { ok: true as const };
}

export async function deleteRule(shop: string, id: string) {
  await db.inboxRule.deleteMany({ where: { id, shop } });
}

export async function toggleRule(shop: string, id: string, on: boolean) {
  await db.inboxRule.updateMany({ where: { id, shop }, data: { on } });
}

// Ready-made automations to start from. Their words have no commas: the
// page splits the words box on commas, so "thanks, that's all" would become a bare "thanks".
export const RULE_TEMPLATES: (Omit<RuleInput, "assignTo"> & { key: string })[] = [
  {
    key: "goodbye",
    name: "Resolve when they say goodbye",
    on: true,
    networks: [],
    kinds: ["message"],
    words: ["goodbye", "bye", "that's all", "all sorted", "cheers"],
    sentiment: "",
    addTags: [],
    reply: "",
    resolve: true,
  },
  {
    key: "order",
    name: "Order questions",
    on: true,
    networks: [],
    kinds: [],
    words: ["order", "tracking", "delivery", "shipped", "arrive", "parcel"],
    sentiment: "",
    addTags: ["order status"],
    reply: "Hi {name}, thanks for getting in touch! Send us your order number in a direct message and we'll check on it for you.",
    resolve: false,
  },
  {
    key: "complaint",
    name: "Unhappy customers first",
    on: true,
    networks: [],
    kinds: [],
    words: [],
    sentiment: "negative",
    addTags: ["complaint"],
    reply: "",
    resolve: false,
  },
  {
    key: "spam",
    name: "Resolve spam",
    on: true,
    networks: [],
    kinds: ["comment"],
    words: ["dm me", "promo code", "crypto", "followers", "collab"],
    sentiment: "",
    addTags: ["spam"],
    reply: "",
    resolve: true,
  },
];

export type Filters = { box?: string | null; network?: string | null; kind?: string | null; tag?: string | null; sentiment?: string | null; q?: string | null; thread?: string | null };

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Everything the inbox page shows: the counts, the conversations in the
// chosen box, the open one's messages, the teammates and the automations.
export async function inboxView(shop: string, filters: Filters = {}, now = new Date()) {
  const networks = openNetworks(shop);
  const accounts = (await db.socialAccount.findMany({ where: { shop }, orderBy: [{ network: "asc" }, { name: "asc" }] })).filter((a) => inboxOpen(shop, a.network));
  const accountIds = accounts.map((a) => a.id);
  const base = { shop, accountId: { in: accountIds } };
  const box = filters.box || "open";
  const where: Record<string, unknown> = { ...base };
  if (box === "open") where.status = "open";
  else if (box === "unassigned") Object.assign(where, { status: "open", assignee: null });
  else if (box === "action") Object.assign(where, { status: "open", OR: [{ assignee: null }, { waitingSince: { lt: new Date(now.getTime() - NEEDS_ACTION_AFTER) } }] });
  else if (box === "resolved") where.status = "resolved";
  else if (box.startsWith("member:")) Object.assign(where, { status: "open", assignee: box.slice(7) });
  if (filters.network && isInboxNetwork(filters.network)) where.network = filters.network;
  if (filters.kind === "comment" || filters.kind === "message") where.kind = filters.kind;
  if (filters.sentiment) where.sentiment = filters.sentiment;
  if (filters.tag) where.tags = { contains: JSON.stringify(filters.tag) };
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const hits = await db.inboxMessage.findMany({ where: { shop, text: { contains: q } }, select: { threadId: true }, take: 500 });
    where.AND = [{ OR: [{ contactName: { contains: q } }, { postText: { contains: q } }, { id: { in: [...new Set(hits.map((h) => h.threadId))] } }] }];
  }

  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - 86400_000);
  const week = new Date(now.getTime() - 7 * 86400_000);
  const [threads, members, rules, open, unassigned, action, resolvedToday, resolvedYesterday, byMember, feelings, tagRows] = await Promise.all([
    db.inboxThread.findMany({ where, orderBy: { lastAt: "desc" }, take: 100 }),
    db.inboxMember.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
    db.inboxRule.findMany({ where: { shop }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.inboxThread.count({ where: { ...base, status: "open" } }),
    db.inboxThread.count({ where: { ...base, status: "open", assignee: null } }),
    db.inboxThread.count({ where: { ...base, status: "open", OR: [{ assignee: null }, { waitingSince: { lt: new Date(now.getTime() - NEEDS_ACTION_AFTER) } }] } }),
    db.inboxThread.count({ where: { ...base, status: "resolved", resolvedAt: { gte: today } } }),
    db.inboxThread.count({ where: { ...base, status: "resolved", resolvedAt: { gte: yesterday, lt: today } } }),
    db.inboxThread.groupBy({ by: ["assignee"], where: { ...base, status: "open", assignee: { not: null } }, _count: true }),
    db.inboxThread.groupBy({ by: ["sentiment"], where: { ...base, lastAt: { gte: week }, sentiment: { not: null } }, _count: true }),
    db.inboxThread.findMany({ where: { ...base, tags: { not: "[]" } }, select: { tags: true }, orderBy: { lastAt: "desc" }, take: 500 }),
  ]);
  const selected = filters.thread ? await db.inboxThread.findFirst({ where: { ...base, id: filters.thread } }) : null;
  const messages = selected ? await db.inboxMessage.findMany({ where: { threadId: selected.id }, orderBy: { at: "asc" } }) : [];
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const tagCount = new Map<string, number>();
  for (const r of tagRows) for (const t of list(r.tags)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const feeling = (s: Sentiment) => feelings.find((f) => f.sentiment === s)?._count ?? 0;
  const show = (t: NonNullable<typeof selected>) => ({
    id: t.id,
    network: t.network as InboxNetwork,
    kind: t.kind as Kind,
    account: accountName.get(t.accountId) ?? "",
    contactName: t.contactName,
    postUrl: t.postUrl,
    postText: t.postText,
    lastText: t.lastText,
    lastAt: t.lastAt.toISOString(),
    lastFrom: t.lastFrom as "them" | "us",
    waitingSince: t.waitingSince?.toISOString() ?? null,
    status: t.status as "open" | "resolved",
    assignee: t.assignee,
    assigneeName: t.assignee ? (memberName.get(t.assignee) ?? null) : null,
    tags: list(t.tags),
    sentiment: t.sentiment as Sentiment | null,
  });
  return {
    networks,
    accounts: accounts.map((a) => ({ id: a.id, network: a.network as InboxNetwork, name: a.name, syncedAt: a.inboxSyncedAt?.toISOString() ?? null, error: a.inboxError })),
    box,
    threads: threads.map(show),
    selected: selected ? { ...show(selected), messages: messages.map((m) => ({ id: m.id, fromUs: m.fromUs, author: m.author, text: m.text, at: m.at.toISOString(), auto: m.auto, by: m.sentBy ? (memberName.get(m.sentBy) ?? null) : null })) } : null,
    counts: { open, unassigned, action, resolvedToday, resolvedYesterday, members: Object.fromEntries(byMember.map((g) => [g.assignee!, g._count])) },
    sentiment: { positive: feeling("positive"), neutral: feeling("neutral"), negative: feeling("negative") },
    tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tag, count]) => ({ tag, count })),
    members: members.map((m) => ({ id: m.id, name: m.name, skills: list(m.skills), routing: m.routing })),
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      on: r.on,
      networks: list(r.networks),
      kinds: list(r.kinds),
      words: list(r.words),
      sentiment: r.sentiment ?? "",
      addTags: list(r.addTags),
      assignTo: r.assignTo ?? "",
      reply: r.reply ?? "",
      resolve: r.resolve,
    })),
    templates: RULE_TEMPLATES,
  };
}
