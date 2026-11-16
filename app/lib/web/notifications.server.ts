import db from "../../db.server";
import { EVENT_LABEL } from "../format";

// The bell in the web version's top bar: competitor changes, people waiting
// in the social inbox, and new mentions from listening, newest first.

export type Notice = { id: string; kind: "competitor" | "inbox" | "mention"; title: string; text: string; at: string; href: string; unread: boolean };

const LOOK_BACK = 30 * 24 * 3600_000;
const SHOWN = 15;
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function notifications(shop: string, seenAt: Date | null, now = Date.now()) {
  const from = new Date(now - LOOK_BACK);
  const [events, threads, mentions] = await Promise.all([
    db.competitorEvent.findMany({
      where: { competitor: { shop }, kind: { not: "tracking" }, createdAt: { gte: from } },
      select: { id: true, kind: true, message: true, createdAt: true, competitor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: SHOWN,
    }),
    db.inboxThread.findMany({
      where: { shop, status: "open", lastFrom: "them", lastAt: { gte: from } },
      select: { id: true, kind: true, network: true, contactName: true, lastText: true, lastAt: true },
      orderBy: { lastAt: "desc" },
      take: SHOWN,
    }),
    db.listenMention.findMany({
      where: { shop, relevant: true, foundAt: { gte: from } },
      select: { id: true, source: true, title: true, text: true, summary: true, place: true, foundAt: true },
      orderBy: { foundAt: "desc" },
      take: SHOWN,
    }),
  ]);
  const list = [
    ...events.map((e) => ({ id: `e${e.id}`, kind: "competitor" as const, title: `${e.competitor.name}: ${EVENT_LABEL[e.kind] ?? "Change"}`, text: e.message, at: e.createdAt, href: `/app/competitors/${e.competitor.id}` })),
    ...threads.map((t) => ({ id: `t${t.id}`, kind: "inbox" as const, title: `${t.contactName} ${t.kind === "message" ? "messaged you" : "commented"}`, text: t.lastText, at: t.lastAt, href: `/app/inbox?t=${t.id}` })),
    ...mentions.map((m) => ({ id: `m${m.id}`, kind: "mention" as const, title: `New mention${m.place ? ` on ${m.place}` : ""}`, text: m.summary ?? m.title ?? m.text, at: m.foundAt, href: "/app/listening" })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, SHOWN);
  const items: Notice[] = list.map((n) => ({ ...n, text: clip(n.text), at: n.at.toISOString(), unread: !seenAt || n.at > seenAt }));
  return { items, unread: items.filter((n) => n.unread).length };
}

export async function markSeen(userId: string, workspaceId: string, at = new Date()) {
  // updateMany: an admin in a workspace for support isn't a member, so has no row.
  await db.workspaceMember.updateMany({ where: { userId, workspaceId }, data: { seenAt: at } });
}
