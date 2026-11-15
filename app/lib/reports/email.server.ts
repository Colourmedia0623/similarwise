import db from "../../db.server";
import { EVENT_LABEL, compact } from "../format";
import {
  AD_NETWORK_NAME,
  addMetrics,
  formatMoney,
  NO_METRICS,
} from "../paidsocial/paid";
import { NETWORK_NAME } from "../social/networks";
import { layout, list } from "../email/alerts.server";
import {
  adminUrl,
  mailer,
  unsubscribeUrl,
  type Email,
  type Mailer,
} from "../email/send.server";
import { performanceReport } from "./report.server";
import { exchangeRates } from "./rates.server";
import { change, inCurrency, roas, type Rates, type Report } from "./report";

// The monthly performance report by email: last month's figures, on the 1st.

const DAY = 86400_000;

// "+12%", "−5%", or nothing when there's no earlier figure.
const delta = (
  now: number | null | undefined,
  before: number | null | undefined,
) => {
  const c = change(now, before);
  return c == null ? "" : ` (${c >= 0 ? "+" : "−"}${Math.abs(c).toFixed(0)}%)`;
};
const n = (v: number | null | undefined) =>
  v == null ? "–" : Math.round(v).toLocaleString("en-GB");

export function reportSections(r: Report) {
  const sections: { title: string; html: string; text: string }[] = [];

  const accounts = r.paid.filter((a) => !a.error);
  if (r.paid.length) {
    const lines: string[] = [];
    // Totals only add up within one currency.
    const currencies = [...new Set(accounts.map((a) => a.currency))];
    if (currencies.length === 1 && accounts.length > 1) {
      const cur = accounts.map((a) => a.current).reduce(addMetrics, NO_METRICS);
      const prev = accounts
        .map((a) => a.previous)
        .reduce(addMetrics, NO_METRICS);
      const x = roas(cur);
      lines.push(
        `All accounts: ${formatMoney(cur.spend, currencies[0])} spent${delta(cur.spend, prev.spend)}, ${formatMoney(cur.value, currencies[0])} in sales${delta(cur.value, prev.value)}, ${x ? `${x.toFixed(1)}× return` : "no tracked sales"}`,
      );
    }
    for (const a of r.paid) {
      if (a.error) {
        lines.push(
          `${AD_NETWORK_NAME[a.network]}, ${a.name}: couldn't be read (${a.error})`,
        );
        continue;
      }
      const x = roas(a.current);
      lines.push(
        `${AD_NETWORK_NAME[a.network]}, ${a.name}: ${formatMoney(a.current.spend, a.currency)} spent${delta(a.current.spend, a.previous.spend)}, ${n(a.current.purchases)} purchases, ${formatMoney(a.current.value, a.currency)} in sales, ${x ? `${x.toFixed(1)}× return` : "no tracked sales"}`,
      );
    }
    sections.push({ title: "Paid social ads", ...list(lines) });
  }

  if (r.social) {
    const s = r.social;
    const lines = [
      `${n(s.current.posts)} posts${delta(s.current.posts, s.previous.posts)}, reaching ${n(s.current.reach)}${delta(s.current.reach, s.previous.reach)}, with ${n(s.current.engagements)} engagements${delta(s.current.engagements, s.previous.engagements)}`,
      ...s.byNetwork.map(
        (b) =>
          `${NETWORK_NAME[b.network]}: ${n(b.posts)} posts, ${n(b.reach)} reach, ${n(b.engagements)} engagements`,
      ),
      ...s.followers.map(
        (f) =>
          `${f.name} on ${NETWORK_NAME[f.network]}: ${n(f.end)} followers${f.start != null && f.end != null && f.end !== f.start ? ` (${f.end > f.start ? "+" : "−"}${n(Math.abs(f.end - f.start))})` : ""}`,
      ),
    ];
    if (s.top[0])
      lines.push(
        `Best post: "${s.top[0].text.slice(0, 80)}" on ${NETWORK_NAME[s.top[0].network]}, ${n(s.top[0].engagements)} engagements`,
      );
    sections.push({ title: "Social posts", ...list(lines) });
  }

  if (r.google) {
    const lines: string[] = [];
    const a = r.google.analytics;
    if (a)
      lines.push(
        `Your website: ${n(a.sessions)} visits${delta(a.sessions, a.prevSessions)}, ${n(a.purchases)} purchases, ${formatMoney(a.revenue, a.currency)} in sales${delta(a.revenue, a.prevRevenue)} (last 28 days)`,
      );
    const g = r.google.ads;
    if (g) {
      const x = roas(g);
      lines.push(
        `Google Ads: ${formatMoney(g.spend, g.currency)} spent${delta(g.spend, g.prevSpend)}, ${formatMoney(g.value, g.currency)} in conversions, ${x ? `${x.toFixed(1)}× return` : "no tracked conversions"} (last 30 days)`,
      );
    }
    sections.push({ title: "Google Analytics and Ads", ...list(lines) });
  }

  if (r.search) {
    const s = r.search;
    sections.push({
      title: "Google rankings",
      ...list([
        `In the top 3 for ${s.top3} of ${s.tracked} tracked searches${s.prevTop3 != null ? ` (was ${s.prevTop3})` : ""}, top 10 for ${s.top10}${s.prevTop10 != null ? ` (was ${s.prevTop10})` : ""}`,
        ...s.movers
          .slice(0, 5)
          .map(
            (m) =>
              `"${m.keyword}": ${m.from ?? "not in top 30"} → ${m.to ?? "not in top 30"}`,
          ),
      ]),
    });
  }

  if (r.competitors) {
    const c = r.competitors;
    sections.push({
      title: "Competitors",
      ...list([
        ...c.rows.map(
          (x) =>
            `${x.name}: ${compact(x.organicTraffic)} search visits a month${delta(x.organicTraffic, x.prevOrganicTraffic)}, ${x.liveAds} live ads${x.newAds ? ` (${x.newAds} new)` : ""}, ${x.changes} changes spotted`,
        ),
        ...(c.events.length
          ? [
              `Changes: ${c.events.map((e) => `${e.count} × ${(EVENT_LABEL[e.kind] ?? e.kind).toLowerCase()}`).join(", ")}`,
            ]
          : []),
      ]),
    });
  }
  return sections;
}

export function reportEmail(r: Report, to: string): Email | null {
  const sections = reportSections(r);
  if (!sections.length) return null;
  const unsubscribe = unsubscribeUrl(r.shop, "report");
  const page = adminUrl(r.shop, "/app/reports?period=last-month");
  sections.push({
    title: "The full report",
    html: `<p style="margin:0">Open it in SimilarWise to see the charts, print it or save it as a PDF: <a href="${page}">Reports</a>.</p>`,
    text: `Open it in SimilarWise to print it or save it as a PDF: ${page}`,
  });
  return {
    to,
    subject: `Your performance report: ${r.range.label}`,
    unsubscribeUrl: unsubscribe,
    ...layout(`Your performance, ${r.range.label}`, sections, {
      shop: r.shop,
      unsubscribe,
      what: "the monthly performance report is",
    }),
  };
}

// On the 1st of each month from 7am UTC, last month's report to each shop that asked for it.
export async function sendMonthlyReports({
  send = mailer(),
  now = new Date(),
  build = performanceReport,
  rates = exchangeRates,
}: {
  send?: Mailer | null;
  now?: Date;
  build?: typeof performanceReport;
  rates?: () => Promise<Rates | null>;
} = {}) {
  if (!send || now.getUTCDate() !== 1 || now.getUTCHours() < 7) return 0;
  const cutoff = new Date(now.getTime() - 20 * DAY);
  const shops = await db.shopSettings.findMany({
    where: {
      reportOn: true,
      alertEmail: { not: null },
      OR: [{ reportSentAt: null }, { reportSentAt: { lt: cutoff } }],
    },
  });
  let sent = 0;
  for (const s of shops) {
    try {
      const report = await build(s.shop, "last-month", { now });
      // In the currency chosen on the Reports page, if one was.
      const email = reportEmail(
        s.reportCurrency
          ? inCurrency(report, s.reportCurrency, await rates())
          : report,
        s.alertEmail!,
      );
      if (email) await send(email);
      await db.shopSettings.update({
        where: { shop: s.shop },
        data: { reportSentAt: now },
      });
      if (email) sent++;
    } catch (err) {
      console.error(`Couldn't email the monthly report to ${s.shop}`, err);
    }
  }
  return sent;
}
