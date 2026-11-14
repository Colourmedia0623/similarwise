import db from "../../db.server";
import { seal, unseal } from "../social/seal.server";
import { adminUrl, escapeHtml, mailer, type Mailer } from "../email/send.server";
import {
  metaCampaigns,
  metaInsights,
  metaSetBudget,
  metaSetStatus,
  tiktokCampaigns,
  tiktokInsights,
  tiktokSetBudget,
  tiktokSetStatus,
  type ConnectedAdAccount,
  type Fetch,
} from "./networks.server";
import { AD_NETWORK_NAME, NO_METRICS, addMetrics, formatMoney, periodDates, roundMoney, type AdNetwork, type Campaign, type Metrics, type Period } from "./paid";

// The merchant's own paid social ads on Facebook, Instagram and TikTok: what
// each campaign spent and brought in, changing budgets and switching
// campaigns on and off, and a monthly spend limit per ad account that emails
// as it gets close and can pause the account's campaigns once it's reached.

type Row = NonNullable<Awaited<ReturnType<typeof db.adAccount.findFirst>>>;

const HOUR = 3600_000;
// A budget raised more than this many times over is most likely a typo.
const MAX_RAISE = 5;

export async function saveAdAccounts(shop: string, accounts: ConnectedAdAccount[]) {
  for (const a of accounts) {
    const data = { name: a.name.slice(0, 200), currency: a.currency.toUpperCase(), token: seal(a.token), tokenExpiresAt: a.expiresAt };
    await db.adAccount.upsert({
      where: { shop_network_accountId: { shop, network: a.network, accountId: a.accountId } },
      update: data,
      create: { shop, network: a.network, accountId: a.accountId, ...data },
    });
  }
  return accounts.length;
}

export async function disconnectAdAccount(shop: string, id: string) {
  await db.adAccount.deleteMany({ where: { id, shop } });
  await db.adSchedule.deleteMany({ where: { adAccountId: id, shop, status: "pending" } });
}

// Our own reasons, shown as they are rather than as something the network said.
class Problem extends Error {}

const said = (a: Row | null, err: unknown) =>
  err instanceof Problem || !a ? (err instanceof Error ? err.message : String(err)) : `${AD_NETWORK_NAME[a.network as AdNetwork]} said: ${err instanceof Error ? err.message : String(err)}`;

function liveToken(a: Row, now: Date) {
  if (a.tokenExpiresAt && a.tokenExpiresAt.getTime() <= now.getTime())
    throw new Problem(`Your ${AD_NETWORK_NAME[a.network as AdNetwork]} sign-in has run out. Press Connect again to carry on.`);
  return unseal(a.token);
}

const campaignsOf = (a: Row, token: string, f: Fetch) =>
  a.network === "meta" ? metaCampaigns(a.accountId, token, a.currency, f) : tiktokCampaigns(a.accountId, token, f);

const insightsOf = (a: Row, token: string, since: string, until: string, f: Fetch) =>
  a.network === "meta" ? metaInsights(a.accountId, token, since, until, f) : tiktokInsights(a.accountId, token, since, until, f);

export type AccountView = {
  id: string;
  network: AdNetwork;
  name: string;
  currency: string;
  expiresSoon: string | null; // When a Meta sign-in runs out, if within two weeks
  limit: { amount: number; pause: boolean; spent: number | null } | null;
  error: string | null;
  totals: Metrics;
  campaigns: (Campaign & Metrics)[];
};

// Every connected ad account with its campaigns and what they did over the period, read live.
export async function paidOverview(shop: string, period: Period, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}): Promise<AccountView[]> {
  const rows = await db.adAccount.findMany({ where: { shop }, orderBy: [{ network: "asc" }, { name: "asc" }] });
  const { since, until } = periodDates(period, now);
  return Promise.all(
    rows.map(async (a): Promise<AccountView> => {
      const base = {
        id: a.id,
        network: a.network as AdNetwork,
        name: a.name,
        currency: a.currency,
        expiresSoon: a.tokenExpiresAt && a.tokenExpiresAt.getTime() - now.getTime() < 14 * 24 * HOUR ? a.tokenExpiresAt.toISOString() : null,
        limit: a.monthlyLimit ? { amount: a.monthlyLimit, pause: a.limitPause, spent: a.monthSpend } : null,
      };
      try {
        const token = liveToken(a, now);
        const [campaigns, metrics] = await Promise.all([campaignsOf(a, token, f), insightsOf(a, token, since, until, f)]);
        const rowsOut = campaigns
          .map((c) => ({ ...c, ...(metrics.get(c.id) ?? NO_METRICS) }))
          // Running campaigns first, then the biggest spenders.
          .sort((x, y) => Number(y.on) - Number(x.on) || y.spend - x.spend || x.name.localeCompare(y.name));
        const totals = [...metrics.values()].reduce(addMetrics, NO_METRICS);
        return { ...base, error: null, totals, campaigns: rowsOut };
      } catch (err) {
        console.error("Couldn't read ad account", shop, a.network, a.accountId, err);
        return { ...base, error: said(a, err), totals: NO_METRICS, campaigns: [] };
      }
    }),
  );
}

// Each ad account's totals for a report's period and the period before, and
// its biggest spending campaigns in the period. Read live from the networks.
export async function paidReport(
  shop: string,
  r: { since: string; until: string; prevSince: string; prevUntil: string },
  { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {},
) {
  const rows = await db.adAccount.findMany({ where: { shop }, orderBy: [{ network: "asc" }, { name: "asc" }] });
  return Promise.all(
    rows.map(async (a) => {
      const base = { network: a.network as AdNetwork, name: a.name, currency: a.currency };
      try {
        const token = liveToken(a, now);
        const [campaigns, cur, prev] = await Promise.all([
          campaignsOf(a, token, f),
          insightsOf(a, token, r.since, r.until, f),
          insightsOf(a, token, r.prevSince, r.prevUntil, f),
        ]);
        const names = new Map(campaigns.map((c) => [c.id, c.name]));
        const top = [...cur.entries()]
          .map(([id, m]) => ({ name: names.get(id) ?? "Deleted campaign", ...m }))
          .filter((c) => c.spend > 0)
          .sort((x, y) => y.spend - x.spend)
          .slice(0, 5);
        const sum = (m: Map<string, Metrics>) => [...m.values()].reduce(addMetrics, NO_METRICS);
        return { ...base, error: null, current: sum(cur), previous: sum(prev), campaigns: top };
      } catch (err) {
        console.error("Couldn't read ad account for a report", shop, a.network, a.accountId, err);
        return { ...base, error: said(a, err), current: NO_METRICS, previous: NO_METRICS, campaigns: [] };
      }
    }),
  );
}

async function account(shop: string, id: string) {
  const a = await db.adAccount.findFirst({ where: { id, shop } });
  if (!a) throw new Problem("That ad account isn't connected any more.");
  return a;
}

const failed = (a: Row | null, err: unknown) => ({ error: said(a, err) });

async function setStatus(a: Row, campaignId: string, on: boolean, f: Fetch, now: Date) {
  const token = liveToken(a, now);
  return a.network === "meta" ? metaSetStatus(a.accountId, campaignId, on, token, a.currency, f) : tiktokSetStatus(a.accountId, campaignId, on, token, f);
}

// Switches one campaign on or off.
type By = "you" | "schedule";

export async function setCampaignOn(shop: string, adAccountId: string, campaignId: string, on: boolean, { f = fetch, now = new Date(), by = "you" }: { f?: Fetch; now?: Date; by?: By } = {}) {
  let a: Row | null = null;
  try {
    a = await account(shop, adAccountId);
    const before = await setStatus(a, campaignId, on, f, now);
    await db.adChange.create({
      data: { shop, adAccountId, campaignId, campaignName: before.name.slice(0, 200), kind: on ? "resume" : "pause", before: before.on ? "on" : "off", after: on ? "on" : "off", by },
    });
    return { ok: true as const };
  } catch (err) {
    return failed(a, err);
  }
}

// Changes one campaign's daily or lifetime budget, whichever it has.
export async function setCampaignBudget(shop: string, adAccountId: string, campaignId: string, amount: number, { f = fetch, now = new Date(), by = "you" }: { f?: Fetch; now?: Date; by?: By } = {}) {
  let a: Row | null = null;
  try {
    a = await account(shop, adAccountId);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a budget above zero." };
    const value = roundMoney(amount, a.currency);
    const token = liveToken(a, now);
    // Read the current budget first, so an accidental extra zero is caught before it's spent.
    const current = (await campaignsOf(a, token, f)).find((c) => c.id === campaignId);
    if (!current) return { error: "That campaign isn't in this ad account." };
    if (current.budget && value > current.budget * MAX_RAISE)
      return { error: `That's more than ${MAX_RAISE} times the current budget of ${formatMoney(current.budget, a.currency)}. Raise it in smaller steps, or in the network's Ads Manager.` };
    const before = a.network === "meta" ? await metaSetBudget(a.accountId, campaignId, value, token, a.currency, f) : await tiktokSetBudget(a.accountId, campaignId, value, token, f);
    await db.adChange.create({
      data: {
        shop,
        adAccountId,
        campaignId,
        campaignName: before.name.slice(0, 200),
        kind: "budget",
        before: before.budget != null ? `${formatMoney(before.budget, a.currency)} ${before.budgetKind === "daily" ? "a day" : "in total"}` : null,
        after: `${formatMoney(value, a.currency)} ${before.budgetKind === "daily" ? "a day" : "in total"}`,
        by,
      },
    });
    return { ok: true as const };
  } catch (err) {
    return failed(a, err);
  }
}

// Sets or clears an ad account's monthly spend limit.
export async function setSpendLimit(shop: string, adAccountId: string, amount: number | null, pause: boolean) {
  if (amount != null && (!Number.isFinite(amount) || amount <= 0)) return { error: "Enter a monthly limit above zero, or leave it empty for none." };
  const res = await db.adAccount.updateMany({
    where: { id: adAccountId, shop },
    // A new limit starts its emails afresh, and is checked on the next hourly run.
    data: { monthlyLimit: amount, limitPause: amount != null && pause, limitNotified: null, monthSpendAt: null },
  });
  return res.count ? { ok: true as const } : { error: "That ad account isn't connected any more." };
}

export async function recentAdChanges(shop: string, take = 20) {
  const [changes, accounts] = await Promise.all([
    db.adChange.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take }),
    db.adAccount.findMany({ where: { shop }, select: { id: true, name: true } }),
  ]);
  const name = new Map(accounts.map((a) => [a.id, a.name]));
  return changes.map((c) => ({ ...c, account: name.get(c.adAccountId) ?? "Disconnected account", createdAt: c.createdAt.toISOString() }));
}

// ---------- Monthly spend limits ----------

export function limitEmail(a: { name: string; network: string; currency: string; monthlyLimit: number }, spent: number, paused: string[], shop: string) {
  const money = (v: number) => formatMoney(v, a.currency);
  const reached = spent >= a.monthlyLimit;
  const where = `${a.name} (${AD_NETWORK_NAME[a.network as AdNetwork]})`;
  const subject = reached ? `${where} has reached its monthly ad limit` : `${where} has spent ${Math.floor((spent / a.monthlyLimit) * 100)}% of its monthly ad limit`;
  const lines = [
    `${where} has spent ${money(spent)} so far this month, against the ${money(a.monthlyLimit)} limit you set in SimilarWise.`,
    paused.length
      ? `As you asked, SimilarWise paused ${paused.length === 1 ? "this campaign" : `these ${paused.length} campaigns`}: ${paused.join(", ")}. You can switch them back on from SimilarWise, and they won't be paused again this month.`
      : reached
        ? "Nothing was paused. Pause campaigns or lower budgets from SimilarWise if you want spending to stop."
        : "Nothing has been paused. You can lower budgets or pause campaigns from SimilarWise.",
  ];
  const link = adminUrl(shop, "/app/paid-social");
  return {
    subject,
    text: `${lines.join("\n\n")}\n\nOpen SimilarWise: ${link}`,
    html: `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p><a href="${escapeHtml(link)}">Open paid social ads in SimilarWise</a></p>`,
  };
}

// Reads each limited account's spend this month (hourly, from the tracker
// schedule), emails at 80% and 100% once a month each, and pauses the
// running campaigns at 100% when the merchant asked for that. A campaign the
// merchant switches back on afterwards is left alone for the rest of the month.
export async function checkSpendLimits({ f = fetch, send = mailer(), now = new Date() }: { f?: Fetch; send?: Mailer | null; now?: Date } = {}) {
  const month = now.toISOString().slice(0, 7);
  const due = await db.adAccount.findMany({
    where: { monthlyLimit: { not: null }, OR: [{ monthSpendAt: null }, { monthSpendAt: { lt: new Date(now.getTime() - 50 * 60_000) } }] },
  });
  for (const a of due) {
    try {
      const token = liveToken(a, now);
      const { since, until } = periodDates("month", now);
      const spent = [...(await insightsOf(a, token, since, until, f)).values()].reduce(addMetrics, NO_METRICS).spend;
      await db.adAccount.update({ where: { id: a.id }, data: { monthSpend: spent, monthSpendAt: now } });
      const limit = a.monthlyLimit!;
      const level = spent >= limit ? 100 : spent >= limit * 0.8 ? 80 : 0;
      const [notifiedMonth, notifiedLevel] = (a.limitNotified ?? "").split(":");
      const already = notifiedMonth === month ? Number(notifiedLevel) || 0 : 0;
      if (!level || level <= already) continue;
      const paused: string[] = [];
      if (level === 100 && a.limitPause) {
        for (const c of (await campaignsOf(a, token, f)).filter((c) => c.on)) {
          try {
            await setStatus(a, c.id, false, f, now);
            await db.adChange.create({ data: { shop: a.shop, adAccountId: a.id, campaignId: c.id, campaignName: c.name.slice(0, 200), kind: "pause", before: "on", after: "off", by: "limit" } });
            paused.push(c.name);
          } catch (err) {
            console.error("Couldn't pause a campaign at its spend limit", a.shop, a.id, c.id, err);
          }
        }
      }
      await db.adAccount.update({ where: { id: a.id }, data: { limitNotified: `${month}:${level}` } });
      const settings = await db.shopSettings.findUnique({ where: { shop: a.shop } });
      if (send && settings?.alertEmail) {
        const email = limitEmail({ ...a, monthlyLimit: limit }, spent, paused, a.shop);
        await send({ to: settings.alertEmail, ...email }).catch((err) => console.error("Couldn't email a spend limit alert", a.shop, err));
      }
    } catch (err) {
      console.error("Couldn't check an ad account's spend limit", a.shop, a.id, err);
    }
  }
}

// ---------- Scheduled changes ----------

const MINUTE = 60_000;
// How far ahead a change can be scheduled.
const SCHEDULE_AHEAD = 366 * 24 * HOUR;

export type AdScheduleKind = "pause" | "resume" | "budget";

// Books a change to one campaign for a set time.
export async function scheduleAdChange(
  shop: string,
  input: { account: string; campaign: string; campaignName: string; kind: string; amount?: number | null; runAt: string },
  now = new Date(),
) {
  const kind = input.kind as AdScheduleKind;
  if (!["pause", "resume", "budget"].includes(kind)) return { error: "Choose what should happen." };
  const runAt = new Date(input.runAt);
  if (Number.isNaN(runAt.getTime())) return { error: "Choose a day and time." };
  if (runAt.getTime() < now.getTime() - MINUTE) return { error: "That time has already passed. Choose a time from now on." };
  if (runAt.getTime() > now.getTime() + SCHEDULE_AHEAD) return { error: "Changes can be scheduled up to a year ahead." };
  const amount = kind === "budget" ? Number(input.amount) : null;
  if (kind === "budget" && (!Number.isFinite(amount) || amount! <= 0)) return { error: "Enter a budget above zero." };
  const a = await db.adAccount.findFirst({ where: { id: input.account, shop } });
  if (!a) return { error: "That ad account isn't connected any more." };
  if (!input.campaign) return { error: "Choose a campaign." };
  await db.adSchedule.create({
    data: {
      shop,
      adAccountId: a.id,
      campaignId: input.campaign,
      campaignName: (input.campaignName || input.campaign).slice(0, 200),
      kind,
      amount: amount == null ? null : roundMoney(amount, a.currency),
      runAt,
    },
  });
  return { ok: true as const };
}

export async function cancelAdSchedule(shop: string, id: string) {
  const res = await db.adSchedule.deleteMany({ where: { id, shop, status: "pending" } });
  return res.count ? { ok: true as const } : { error: "That change has already run, or was cancelled." };
}

export type AdScheduleView = {
  id: string;
  adAccountId: string;
  campaignName: string;
  kind: AdScheduleKind;
  amount: number | null;
  runAt: string;
  status: "pending" | "failed";
  error: string | null;
};

// What's still to come, and anything that didn't go through in the last week.
export async function adSchedules(shop: string, now = new Date()): Promise<AdScheduleView[]> {
  const rows = await db.adSchedule.findMany({
    where: { shop, OR: [{ status: { in: ["pending", "running"] } }, { status: "failed", runAt: { gt: new Date(now.getTime() - 7 * 24 * HOUR) } }] },
    orderBy: { runAt: "asc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    adAccountId: r.adAccountId,
    campaignName: r.campaignName,
    kind: r.kind as AdScheduleKind,
    amount: r.amount,
    runAt: r.runAt.toISOString(),
    status: r.status === "failed" ? "failed" : "pending",
    error: r.error,
  }));
}

// True when this month's limit has been reached on an account set to pause at it.
function limitHolds(a: Row, now: Date) {
  return !!a.monthlyLimit && a.limitPause && (a.limitNotified ?? "") === `${now.toISOString().slice(0, 7)}:100`;
}

export function scheduleFailedEmail(r: { campaignName: string; kind: string; error: string }, accountName: string, shop: string) {
  const what = r.kind === "budget" ? "budget change" : r.kind === "pause" ? "pause" : "switch on";
  const line = `The scheduled ${what} for ${r.campaignName} (${accountName}) didn't go through: ${r.error}`;
  const link = adminUrl(shop, "/app/paid-social");
  return {
    subject: `A scheduled ad change for ${r.campaignName} didn't go through`,
    text: `${line}\n\nOpen SimilarWise: ${link}`,
    html: `<p>${escapeHtml(line)}</p><p><a href="${escapeHtml(link)}">Open paid social ads in SimilarWise</a></p>`,
  };
}

// Makes the changes that are due (every minute, from the ad schedule).
export async function runAdSchedules({ f = fetch, send = mailer(), now = new Date() }: { f?: Fetch; send?: Mailer | null; now?: Date } = {}) {
  const due = await db.adSchedule.findMany({ where: { status: "pending", runAt: { lte: now } }, orderBy: { runAt: "asc" }, take: 50 });
  for (const r of due) {
    // Claim it first, so a change never runs twice.
    const claimed = await db.adSchedule.updateMany({ where: { id: r.id, status: "pending" }, data: { status: "running" } });
    if (!claimed.count) continue;
    let error: string | null = null;
    const a = await db.adAccount.findFirst({ where: { id: r.adAccountId, shop: r.shop } });
    try {
      if (!a) error = "The ad account isn't connected any more.";
      else if (r.kind === "resume" && limitHolds(a, now)) error = "This month's spend limit has been reached, so the campaign was left paused.";
      else {
        const res =
          r.kind === "budget"
            ? await setCampaignBudget(r.shop, r.adAccountId, r.campaignId, r.amount ?? 0, { f, now, by: "schedule" })
            : await setCampaignOn(r.shop, r.adAccountId, r.campaignId, r.kind === "resume", { f, now, by: "schedule" });
        if ("error" in res) error = res.error;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await db.adSchedule.update({ where: { id: r.id }, data: { status: error ? "failed" : "done", error, doneAt: now } });
    if (error) {
      console.error("A scheduled ad change failed", r.shop, r.id, error);
      const settings = await db.shopSettings.findUnique({ where: { shop: r.shop } });
      if (send && settings?.alertEmail)
        await send({ to: settings.alertEmail, ...scheduleFailedEmail({ ...r, error }, a?.name ?? "Disconnected account", r.shop) }).catch((err) =>
          console.error("Couldn't email a failed ad change", r.shop, err),
        );
    }
  }
}

let started = false;
let running = false;

// Checks for due changes every minute.
export function startAdSchedule() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  setInterval(() => {
    if (running) return;
    running = true;
    void runAdSchedules()
      .catch((err) => console.error("Scheduled ad changes failed", err))
      .finally(() => (running = false));
  }, MINUTE).unref();
}
