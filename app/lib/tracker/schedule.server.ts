import { checkCompetitor, staleCompetitors } from "./check.server";
import { refreshTraffic } from "../traffic/refresh.server";
import { refreshGap } from "../traffic/gap.server";
import { refreshAds } from "../ads/ads.server";
import { refreshLinks } from "../links/links.server";
import { refreshAllOwnTraffic } from "../traffic/channels.server";
import { refreshAllOwnTech } from "./tech.server";
import { refreshAllSimilar } from "../traffic/similar.server";
import { sendAlerts, sendDigests } from "../email/alerts.server";
import { runCalendar } from "../ideas/calendar.server";
import { refreshAllAiMentions } from "../ai/mentions.server";
import { refreshAllListening } from "../listening/listening.server";
import { refreshAllRanks } from "../ranks/ranks.server";
import { refreshAllAudits } from "../audit/audit.server";
import { refreshAllGoogle } from "../google/google.server";
import { checkSpendLimits } from "../paidsocial/paid.server";
import { sendDuePosts } from "../social/publishing.server";
import { recordFollowers, refreshStats } from "../social/social.server";
import { syncAllInboxes } from "../inbox/inbox.server";
import { sendMonthlyReports } from "../reports/email.server";

// Every hour, re-checks the competitors nobody has checked in a day, one at
// a time, and their search traffic and keyword gap, ads and link gap when they're a week old.
// Then reads the shops' own storefronts daily, finds similar sites weekly, writes the blog posts due on the content calendar, asks AI assistants the shops' questions weekly, collects what people say about the shops and their competitors every three days, checks the shops' tracked Google rankings daily, audits the shops' own storefronts weekly, reads their own Google Analytics and Ads figures daily, checks their paid social spend against its monthly limits,
// and every minute sends the social calendar posts that are due, every five minutes reads new comments and messages into the social inbox, and hourly reads how sent posts are doing,
// and emails what changed, on Mondays the weekly summary, and on the 1st last month's performance report.

const HOUR = 3600_000;
let started = false;
let running = false;

export async function checkStale() {
  if (running) return;
  running = true;
  try {
    for (const c of await staleCompetitors()) {
      await checkCompetitor(c.id).catch((err) => console.error(`Couldn't check competitor ${c.id}`, err));
      await refreshTraffic(c.id).catch((err) => console.error(`Couldn't refresh traffic for ${c.id}`, err));
      await refreshGap(c.id).catch((err) => console.error(`Couldn't refresh the keyword gap for ${c.id}`, err));
      await refreshAds(c.id).catch((err) => console.error(`Couldn't refresh ads for ${c.id}`, err));
      await refreshLinks(c.id).catch((err) => console.error(`Couldn't refresh the link gap for ${c.id}`, err));
    }
    await refreshAllOwnTraffic();
    await refreshAllOwnTech();
    await refreshAllSimilar();
    await runCalendar().catch((err) => console.error("Couldn't run the content calendar", err));
    await refreshAllAiMentions().catch((err) => console.error("Couldn't check AI mentions", err));
    await refreshAllListening().catch((err) => console.error("Couldn't check social listening", err));
    await refreshAllRanks().catch((err) => console.error("Couldn't check rankings", err));
    await refreshAllAudits().catch((err) => console.error("Couldn't audit storefronts", err));
    await refreshAllGoogle().catch((err) => console.error("Couldn't read Google figures", err));
    await checkSpendLimits().catch((err) => console.error("Couldn't check ad spend limits", err));
    await sendAlerts().catch((err) => console.error("Couldn't send alerts", err));
    await sendDigests().catch((err) => console.error("Couldn't send weekly summaries", err));
    await sendMonthlyReports().catch((err) => console.error("Couldn't send monthly reports", err));
  } finally {
    running = false;
  }
}

export function startTrackerSchedule() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  setInterval(() => void checkStale().catch((err) => console.error("Tracker run failed", err)), HOUR).unref();
  setTimeout(() => void checkStale().catch((err) => console.error("Tracker run failed", err)), 60_000).unref();
  // Likes, comments and reach for sent social posts, read hourly.
  setInterval(
    () =>
      void refreshStats()
        .then(() => recordFollowers())
        .catch((err) => console.error("Couldn't read social engagement", err)),
    HOUR,
  ).unref();
  // Social calendar posts go out on the minute they're due.
  setInterval(() => void sendDuePosts().catch((err) => console.error("Couldn't send scheduled social posts", err)), 60_000).unref();
  // New comments and messages for the social inbox.
  setInterval(() => void syncAllInboxes().catch((err) => console.error("Couldn't read the social inbox", err)), 5 * 60_000).unref();
}
