import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import { fetchPublic, type Fetcher } from "../tracker/fetch.server";
import { linkGap, writePitch } from "./links.server";

// Outreach: an email to each site in the link gap asking it to link to the
// shop. The site's own pages are read for what it's about and an address to
// write to, Claude writes the email, and the merchant sends it from their
// own mailbox, then marks how it went. A follow-up is offered a week after
// sending when there's no reply.

const FOLLOW_UP_AFTER = 7 * 86400_000;
const MAX_FOLLOW_UPS = 2;
const BATCH = 5;

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Addresses that turn up in page code but aren't anyone to write to.
const NOT_PEOPLE = /\.(png|jpe?g|gif|webp|svg)$|example\.|sentry|wixpress|@(domain|email|yourdomain)\.|noreply|no-reply|u00/i;
const CONTACT_PAGE = /contact|about|write-for-us|advertis|partner|press/i;

const text = (html: string, re: RegExp) => re.exec(html)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 300) ?? null;

export type SiteContacts = { title: string | null; description: string | null; emails: string[] };

// Reads the site's home page and up to two of its contact or about pages.
// Addresses on the site's own domain come first.
export async function findContacts(domain: string, fetcher: Fetcher = fetchPublic): Promise<SiteContacts> {
  const home = await fetcher(`https://${domain}/`, "text/html");
  const found = new Set<string>();
  const collect = (html: string) => {
    for (const m of html.replace(/&#64;|\s?\[at\]\s?|\s?\(at\)\s?/gi, "@").matchAll(EMAIL)) {
      const e = m[0].toLowerCase().replace(/^mailto:/, "");
      if (!NOT_PEOPLE.test(e)) found.add(e);
    }
  };
  collect(home.body);
  const base = new URL(home.url);
  const pages = [...home.body.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((m) => {
      try {
        return new URL(m[1], base);
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => !!u && u.hostname === base.hostname && CONTACT_PAGE.test(u.pathname))
    .map((u) => u.toString())
    .filter((u, i, all) => all.indexOf(u) === i)
    .slice(0, 2);
  for (const page of pages) {
    const res = await fetcher(page, "text/html").catch(() => null);
    if (res && res.status < 400) collect(res.body);
  }
  const root = domain.replace(/^www\./, "");
  const emails = [...found].sort((a, b) => Number(b.endsWith(`@${root}`)) - Number(a.endsWith(`@${root}`))).slice(0, 5);
  return {
    title: text(home.body, /<title[^>]*>([^<]*)<\/title>/i),
    description: text(home.body, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ?? text(home.body, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    emails,
  };
}

// Starts outreach to one site: finds who to write to and writes the email.
export async function startOutreach(shop: string, domain: string, { ask = claudeJson(), fetcher = fetchPublic }: { ask?: AskJson | null; fetcher?: Fetcher } = {}) {
  const existing = await db.outreach.findUnique({ where: { shop_domain: { shop, domain } } });
  if (existing) return { id: existing.id };
  const contacts = await findContacts(domain, fetcher).catch((): SiteContacts => ({ title: null, description: null, emails: [] }));
  const pitch = await writePitch(shop, domain, ask, { title: contacts.title, description: contacts.description });
  if ("error" in pitch) return pitch;
  const row = await db.outreach.create({
    data: { shop, domain, siteTitle: contacts.title, emails: JSON.stringify(contacts.emails), to: contacts.emails[0] ?? null, ...pitch },
  });
  return { id: row.id };
}

// Starts outreach to the best few sites in the link gap that don't have any
// yet. Sites where anyone can post (forums, directories) are left out.
export async function startTopOutreach(shop: string, opts: { ask?: AskJson | null; fetcher?: Fetcher } = {}) {
  const [gap, started] = await Promise.all([linkGap(shop), db.outreach.findMany({ where: { shop }, select: { domain: true } })]);
  const done = new Set(started.map((o) => o.domain));
  const next = gap.sites.filter((s) => !s.platform && !done.has(s.domain)).slice(0, BATCH);
  if (!next.length) return { error: gap.sites.length ? "Every site in your link gap already has an email." : "There's no link gap yet. Refresh the Link gap page first." };
  const results = await Promise.all(next.map((s) => startOutreach(shop, s.domain, opts).catch(() => ({ error: "failed" }))));
  const count = results.filter((r) => "id" in r).length;
  return count ? { count } : { error: "Couldn't write the emails just now. Try again in a minute." };
}

const FOLLOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: { subject: { type: "string" }, body: { type: "string" } },
};

const FOLLOW_SYSTEM = `You write a short, polite follow-up to an outreach email a small online shop sent a week ago and got no reply to. You get the first email. Write a new body under 70 words that briefly restates the ask in a fresh way and makes it easy to say yes or no, plain text, with [Your name] as the signature. Keep the subject as "Re: " and the original subject. No guilt-tripping, no "just bumping this".`;

export async function writeFollowUp(shop: string, id: string, ask: AskJson | null = claudeJson()) {
  if (!ask) return { error: "Outreach emails aren't switched on for this app yet." };
  const o = await db.outreach.findFirst({ where: { id, shop } });
  if (!o) return { error: "That email isn't there any more." };
  if (o.followUps >= MAX_FOLLOW_UPS) return { error: "You've followed up twice already. It's best to leave this one." };
  const out = (await ask(FOLLOW_SYSTEM, { site: o.domain, subject: o.subject, body: o.body }, FOLLOW_SCHEMA)) as { subject?: unknown; body?: unknown } | null;
  const body = typeof out?.body === "string" ? out.body.trim() : "";
  if (!body) return { error: "Couldn't write the follow-up. Try again." };
  const subject = o.subject.startsWith("Re: ") ? o.subject : `Re: ${o.subject}`;
  await db.outreach.update({ where: { id }, data: { subject, body, status: "draft", followUps: { increment: 1 } } });
  return { ok: true as const };
}

export async function editOutreach(shop: string, id: string, edit: { to: string; subject: string; body: string }) {
  const to = edit.to.trim().slice(0, 200);
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: "That email address doesn't look right." };
  const subject = edit.subject.trim().slice(0, 200);
  const body = edit.body.trim().slice(0, 5000);
  if (!subject || !body) return { error: "The email needs a subject and some words." };
  await db.outreach.updateMany({ where: { id, shop }, data: { to: to || null, subject, body } });
  return { ok: true as const };
}

export const STATUSES = ["draft", "sent", "replied", "linked", "declined"] as const;

export async function setOutreachStatus(shop: string, id: string, status: string, now = new Date()) {
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { error: "Unknown status" };
  const o = await db.outreach.findFirst({ where: { id, shop } });
  if (!o) return { error: "That email isn't there any more." };
  await db.outreach.update({
    where: { id },
    data: { status, ...(status === "sent" ? { lastSentAt: now, sentAt: o.sentAt ?? now } : {}) },
  });
  return { ok: true as const };
}

export async function deleteOutreach(shop: string, id: string) {
  await db.outreach.deleteMany({ where: { id, shop } });
}

export async function outreachList(shop: string, now = new Date()) {
  const rows = await db.outreach.findMany({ where: { shop }, orderBy: [{ updatedAt: "desc" }] });
  return rows.map((o) => ({
    id: o.id,
    domain: o.domain,
    siteTitle: o.siteTitle,
    emails: JSON.parse(o.emails) as string[],
    to: o.to,
    subject: o.subject,
    body: o.body,
    status: o.status,
    followUps: o.followUps,
    sentAt: o.sentAt?.toISOString() ?? null,
    lastSentAt: o.lastSentAt?.toISOString() ?? null,
    followUpDue: o.status === "sent" && !!o.lastSentAt && now.getTime() - o.lastSentAt.getTime() > FOLLOW_UP_AFTER && o.followUps < MAX_FOLLOW_UPS,
  }));
}

export async function outreachByDomain(shop: string) {
  const rows = await db.outreach.findMany({ where: { shop }, select: { domain: true, status: true } });
  return Object.fromEntries(rows.map((r) => [r.domain, r.status]));
}
