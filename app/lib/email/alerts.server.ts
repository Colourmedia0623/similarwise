import db from "../../db.server";
import { EVENT_LABEL, compact, formatPrice } from "../format";
import { priceComparison } from "../prices/prices.server";
import { keywordGap } from "../traffic/gap.server";
import { adminUrl, escapeHtml, mailer, unsubscribeUrl, type Email, type Mailer } from "./send.server";

// Emails merchants when their competitors change, and a summary every Monday.

export const TOPICS = [
  { key: "prices", label: "Price cuts and rises", kinds: ["price_down", "price_up"] },
  { key: "products", label: "New products and products taken down", kinds: ["launch", "removed"] },
  {
    key: "ads",
    label: "Ads, apps and ad spend",
    kinds: ["channel_added", "channel_removed", "app_added", "app_removed", "theme_changed", "spend_up", "spend_down"],
  },
  { key: "traffic", label: "Big changes in search traffic", kinds: ["traffic_up", "traffic_down"] },
] as const;

export type Topic = (typeof TOPICS)[number]["key"];

export function parseTopics(stored: string | null | undefined): Topic[] {
  try {
    const list = JSON.parse(stored ?? "[]");
    return TOPICS.map((t) => t.key).filter((k) => Array.isArray(list) && list.includes(k));
  } catch {
    return [];
  }
}

const kindsFor = (topics: Topic[]) => TOPICS.filter((t) => topics.includes(t.key)).flatMap((t) => [...t.kinds]);

const DAY = 24 * 3600_000;
const MAX_LISTED = 25;

// Fills in where emails go from the shop's email address the first time it
// opens the app.
export async function detectAlertEmail(shop: string, readEmail: () => Promise<string | null>) {
  const s = await db.shopSettings.findUnique({ where: { shop } });
  if (s?.alertEmail != null) return;
  let email: string | null = null;
  try {
    email = await readEmail();
  } catch {
    // They can enter it on the settings page.
  }
  if (!email) return;
  if (s) await db.shopSettings.updateMany({ where: { shop, alertEmail: null }, data: { alertEmail: email } });
  else await db.shopSettings.upsert({ where: { shop }, create: { shop, alertEmail: email }, update: {} });
}

type Event = { kind: string; message: string; createdAt: Date; competitor: { id: string; name: string } };

function groupByCompetitor(events: Event[]) {
  const groups = new Map<string, { name: string; events: Event[] }>();
  for (const e of events) {
    const g = groups.get(e.competitor.id) ?? { name: e.competitor.name, events: [] };
    g.events.push(e);
    groups.set(e.competitor.id, g);
  }
  return [...groups.values()];
}

// Shared look for both emails: a heading, sections, and a footer with the
// link that turns this email off.
function layout(heading: string, sections: { title: string; html: string; text: string }[], footer: { shop: string; unsubscribe: string; what: string }) {
  const settings = adminUrl(footer.shop, "/app/settings");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fa;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f1b2d">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2f5bea;font-weight:700">Similarwise</p>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(heading)}</h1>
${sections.map((s) => `<h2 style="margin:24px 0 8px;font-size:16px">${escapeHtml(s.title)}</h2>${s.html}`).join("\n")}
<p style="margin:24px 0 0"><a href="${adminUrl(footer.shop)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#2f5bea;color:#fff;text-decoration:none;font-weight:600">Open Similarwise</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#4a5568">You get this email because ${escapeHtml(footer.what)} on for ${escapeHtml(footer.shop)}.
<a href="${settings}" style="color:inherit">Email settings</a> · <a href="${footer.unsubscribe}" style="color:inherit">Turn this email off</a></p>
</div></body></html>`;
  const text = [
    heading,
    "",
    ...sections.flatMap((s) => [s.title, s.text, ""]),
    `Open Similarwise: ${adminUrl(footer.shop)}`,
    `Turn this email off: ${footer.unsubscribe}`,
  ].join("\n");
  return { html, text };
}

const list = (items: string[]) => ({
  html: `<ul style="margin:0;padding-left:20px;line-height:1.6">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`,
  text: items.map((i) => `- ${i}`).join("\n"),
});

export function alertEmail(shop: string, to: string, events: Event[]): Email {
  const groups = groupByCompetitor(events);
  const sections = groups.map((g) => {
    const shown = g.events.slice(0, MAX_LISTED).map((e) => `${EVENT_LABEL[e.kind] ?? e.kind}: ${e.message}`);
    if (g.events.length > MAX_LISTED) shown.push(`…and ${g.events.length - MAX_LISTED} more`);
    return { title: g.name, ...list(shown) };
  });
  const names = groups.map((g) => g.name);
  const subject =
    names.length === 1
      ? `${names[0]}: ${events.length === 1 ? (EVENT_LABEL[events[0].kind] ?? "a change").toLowerCase() : `${events.length} changes`}`
      : `${events.length} changes at ${names.length} competitors`;
  const unsubscribe = unsubscribeUrl(shop, "alerts");
  return {
    to,
    subject,
    unsubscribeUrl: unsubscribe,
    ...layout(
      events.length === 1 ? "A competitor changed something" : "Your competitors changed things",
      sections,
      { shop, unsubscribe, what: "competitor alerts are" },
    ),
  };
}

// Sends each shop one email with its competitors' changes since the last
// one. A shop turning alerts on starts from now, not from its whole history.
export async function sendAlerts({ send = mailer(), now = new Date() }: { send?: Mailer | null; now?: Date } = {}) {
  if (!send) return 0;
  const shops = await db.shopSettings.findMany({ where: { alertsOn: true, alertEmail: { not: null } } });
  let sent = 0;
  for (const s of shops) {
    if (!s.alertsSentAt) {
      await db.shopSettings.update({ where: { shop: s.shop }, data: { alertsSentAt: now } });
      continue;
    }
    const events = await db.competitorEvent.findMany({
      where: {
        competitor: { shop: s.shop },
        createdAt: { gt: s.alertsSentAt, lte: now },
        kind: { in: kindsFor(parseTopics(s.alertTopics)) },
      },
      orderBy: { createdAt: "asc" },
      include: { competitor: { select: { id: true, name: true } } },
    });
    try {
      if (events.length) await send(alertEmail(s.shop, s.alertEmail!, events));
      await db.shopSettings.update({ where: { shop: s.shop }, data: { alertsSentAt: now } });
      if (events.length) sent++;
    } catch (err) {
      // The watermark stays, so the next run tries these changes again.
      console.error(`Couldn't email alerts to ${s.shop}`, err);
    }
  }
  return sent;
}

export async function digestEmail(shop: string, to: string, now = new Date()): Promise<Email | null> {
  const since = new Date(now.getTime() - 7 * DAY);
  const [events, prices, gap] = await Promise.all([
    db.competitorEvent.findMany({
      where: { competitor: { shop }, createdAt: { gt: since, lte: now }, kind: { not: "tracking" } },
      orderBy: { createdAt: "desc" },
      include: { competitor: { select: { id: true, name: true } } },
    }),
    priceComparison(shop),
    keywordGap(shop),
  ]);
  if (prices.competitors.length === 0) return null;

  const sections: { title: string; html: string; text: string }[] = [];
  const groups = groupByCompetitor(events);
  if (groups.length === 0) {
    sections.push({ title: "This week", ...list(["No changes at your competitors."]) });
  } else {
    for (const g of groups) {
      const counts = new Map<string, number>();
      for (const e of g.events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      const summary = [...counts].map(([k, n]) => `${n} × ${(EVENT_LABEL[k] ?? k).toLowerCase()}`).join(", ");
      const latest = g.events.slice(0, 5).map((e) => e.message);
      sections.push({ title: `${g.name}: ${summary}`, ...list(latest) });
    }
  }

  if (prices.totals.matched > 0) {
    const undercuts = prices.rows
      .flatMap((r) =>
        r.cells.flatMap((c, i) =>
          c && !c.removed && c.gap != null && c.gap < 0
            ? [{ text: `${r.title}: ${prices.competitors[i].name} sells it for ${formatPrice(c.priceCents, c.currency)}, ${Math.round(-c.gap * 100)}% less than your ${formatPrice(r.priceCents, r.currency)}`, gap: c.gap }]
            : [],
        ),
      )
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 5)
      .map((u) => u.text);
    sections.push({
      title: `Prices: a competitor is cheaper on ${prices.totals.undercut} of ${prices.totals.matched} matched products`,
      ...list(undercuts.length ? undercuts : ["You're the cheapest on every matched product."]),
    });
  }

  if (gap.totals.missing > 0) {
    sections.push({
      title: `Search: ${gap.totals.missing} ${gap.totals.missing === 1 ? "search brings" : "searches bring"} competitors ${compact(gap.totals.missingVisits)} visits a month where you don't rank`,
      ...list(
        gap.missing
          .slice(0, 5)
          .map((r) => `"${r.keyword}": ${r.searchVolume?.toLocaleString("en") ?? "?"} searches a month, ${r.competitors[0].name} is #${r.competitors[0].position ?? "?"}`),
      ),
    });
  }

  const unsubscribe = unsubscribeUrl(shop, "digest");
  const changes = events.length;
  return {
    to,
    subject: changes ? `Your week: ${changes} competitor ${changes === 1 ? "change" : "changes"}` : "Your week: no competitor changes",
    unsubscribeUrl: unsubscribe,
    ...layout("Your competitors this week", sections, { shop, unsubscribe, what: "the weekly summary is" }),
  };
}

// Mondays from 7am UTC, one summary per shop.
export async function sendDigests({ send = mailer(), now = new Date() }: { send?: Mailer | null; now?: Date } = {}) {
  if (!send || now.getUTCDay() !== 1 || now.getUTCHours() < 7) return 0;
  const cutoff = new Date(now.getTime() - 6 * DAY);
  const shops = await db.shopSettings.findMany({
    where: { digestOn: true, alertEmail: { not: null }, OR: [{ digestSentAt: null }, { digestSentAt: { lt: cutoff } }] },
  });
  let sent = 0;
  for (const s of shops) {
    try {
      const email = await digestEmail(s.shop, s.alertEmail!, now);
      if (email) await send(email);
      await db.shopSettings.update({ where: { shop: s.shop }, data: { digestSentAt: now } });
      if (email) sent++;
    } catch (err) {
      console.error(`Couldn't email the weekly summary to ${s.shop}`, err);
    }
  }
  return sent;
}
