import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { isFreeShop } from "../lib/waitlist.server";
import { signState } from "../lib/social/seal.server";
import { timeAgo } from "../lib/format";
import { adAuthorizeUrl, adNetworkApproved, adNetworkOn } from "../lib/paidsocial/networks.server";
import { disconnectAdAccount, paidOverview, recentAdChanges, setCampaignBudget, setCampaignOn, setSpendLimit, type AccountView } from "../lib/paidsocial/paid.server";
import { AD_NETWORK_NAME, PERIODS, formatMoney, parsePeriod, type AdNetwork, type Metrics } from "../lib/paidsocial/paid";

// Paid social ads: the merchant's own Facebook, Instagram and TikTok
// campaigns, what they cost and bring in, with budgets, on/off switches and a
// monthly spend limit per ad account.

const SIGN_IN_FOR = 30 * 60_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  const link = (n: AdNetwork) =>
    adNetworkOn(n) && (adNetworkApproved(n) || isFreeShop(shop)) ? adAuthorizeUrl(n, signState({ shop, network: `${n}-ads`, exp: Date.now() + SIGN_IN_FOR })) : null;
  const [accounts, changes] = await Promise.all([paidOverview(shop, period), recentAdChanges(shop)]);
  return { period, accounts, changes, meta: link("meta"), tiktok: link("tiktok") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const account = String(form.get("account") ?? "");
  const campaign = String(form.get("campaign") ?? "");
  if (intent === "on" || intent === "off") return setCampaignOn(shop, account, campaign, intent === "on");
  if (intent === "budget") return setCampaignBudget(shop, account, campaign, Number(form.get("amount")));
  if (intent === "limit") {
    const raw = String(form.get("amount") ?? "").trim();
    return setSpendLimit(shop, account, raw ? Number(raw) : null, form.get("pause") === "true");
  }
  if (intent === "disconnect") {
    await disconnectAdAccount(shop, account);
    return { ok: true as const };
  }
  return { error: "Unknown action" };
};

const whole = (v: number) => Math.round(v).toLocaleString("en-GB");
const roas = (m: Metrics) => (m.spend && m.value ? `${(m.value / m.spend).toFixed(1)}×` : "–");

function Tiles({ m, currency }: { m: Metrics; currency: string }) {
  const tiles = [
    { label: "Spend", value: formatMoney(m.spend, currency) },
    { label: "Clicks", value: whole(m.clicks) },
    { label: "Cost per click", value: m.clicks ? formatMoney(m.spend / m.clicks, currency) : "–" },
    { label: "Purchases", value: whole(m.purchases) },
    { label: "Cost per purchase", value: m.purchases ? formatMoney(m.spend / m.purchases, currency) : "–" },
    { label: "Return on ad spend", value: roas(m) },
  ];
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
      {tiles.map((t) => (
        <s-box key={t.label} padding="base" background="subdued" borderRadius="base">
          <s-stack gap="small-200">
            <s-text color="subdued">{t.label}</s-text>
            <s-heading>{t.value}</s-heading>
          </s-stack>
        </s-box>
      ))}
    </s-grid>
  );
}

export default function PaidSocial() {
  const d = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Signing in happens in another tab; pick up the new accounts on coming back.
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && revalidator.revalidate();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [revalidator]);

  return (
    <s-page heading="Paid social ads">
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            See what your Facebook, Instagram and TikTok ad campaigns cost and what they bring in, all in one place. Change a campaign&apos;s budget,
            pause or restart it, and set a monthly limit on each ad account so you&apos;re told before spending runs over. Signing in opens in a new tab.
          </s-paragraph>
          <s-stack direction="inline" gap="small">
            {d.meta ? (
              <s-button variant="primary" href={d.meta} target="_blank">
                Connect Facebook and Instagram ads
              </s-button>
            ) : (
              <s-button disabled>Facebook and Instagram ads coming soon</s-button>
            )}
            {d.tiktok ? (
              <s-button href={d.tiktok} target="_blank">
                Connect TikTok ads
              </s-button>
            ) : (
              <s-button disabled>TikTok ads coming soon</s-button>
            )}
          </s-stack>
          {(!d.meta || !d.tiktok) && (
            <s-text color="subdued">Ad networks marked coming soon open once they&apos;ve finished approving SimilarWise to manage ads. We&apos;ll email you when it&apos;s ready.</s-text>
          )}
          {d.accounts.length > 0 && (
            <s-select label="Figures for" value={d.period} onChange={(e) => navigate(`?period=${e.currentTarget.value}`)}>
              {PERIODS.map((p) => (
                <s-option key={p.key} value={p.key}>
                  {p.label}
                </s-option>
              ))}
            </s-select>
          )}
        </s-stack>
      </s-section>

      {d.accounts.map((a) => (
        <Account key={a.id} a={a} />
      ))}

      {d.changes.length > 0 && (
        <s-section heading="Recent changes">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Campaign</s-table-header>
              <s-table-header>Change</s-table-header>
              <s-table-header>By</s-table-header>
              <s-table-header>When</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.changes.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>{`${c.campaignName} (${c.account})`}</s-table-cell>
                  <s-table-cell>{c.kind === "budget" ? `Budget ${c.before ? `${c.before} → ` : "→ "}${c.after}` : c.kind === "pause" ? "Paused" : "Switched on"}</s-table-cell>
                  <s-table-cell>{c.by === "limit" ? "Monthly limit" : "You"}</s-table-cell>
                  <s-table-cell>{timeAgo(c.createdAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

function Account({ a }: { a: AccountView }) {
  const act = useFetcher<typeof action>();
  const busy = act.state !== "idle";
  return (
    <s-section heading={a.name}>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone={a.network === "meta" ? "info" : "neutral"}>{AD_NETWORK_NAME[a.network]}</s-badge>
          <s-text color="subdued">{a.currency}</s-text>
          <s-button variant="tertiary" tone="critical" loading={busy && act.formData?.get("intent") === "disconnect"} onClick={() => act.submit({ intent: "disconnect", account: a.id }, { method: "post" })}>
            Disconnect
          </s-button>
        </s-stack>
        {a.expiresSoon && (
          <s-banner tone="warning">{`Meta asks you to sign in again every 60 days. This connection runs out on ${new Date(a.expiresSoon).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}; press Connect above to renew it.`}</s-banner>
        )}
        {a.error ? (
          <s-banner tone="warning">{a.error}</s-banner>
        ) : (
          <>
            <Tiles m={a.totals} currency={a.currency} />
            <SpendLimit a={a} />
            <Campaigns a={a} />
          </>
        )}
      </s-stack>
    </s-section>
  );
}

// An editor that closes itself once what it saved has gone through.
function useEditor(act: ReturnType<typeof useFetcher<typeof action>>) {
  const [opened, setOpened] = useState<{ data: unknown } | null>(null);
  const saved = !!opened && act.state === "idle" && act.data !== opened.data && !!act.data && "ok" in act.data;
  return [!!opened && !saved, (open: boolean) => setOpened(open ? { data: act.data } : null)] as const;
}

function SpendLimit({ a }: { a: AccountView }) {
  const act = useFetcher<typeof action>();
  const [editing, setEditing] = useEditor(act);
  const [amount, setAmount] = useState(a.limit ? String(a.limit.amount) : "");
  const [pause, setPause] = useState(a.limit?.pause ?? false);
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;

  const l = a.limit;
  const pct = l && l.spent != null ? Math.round((l.spent / l.amount) * 100) : null;
  if (!editing)
    return (
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          {l ? (
            <s-stack gap="small-200">
              <s-text type="strong">{`Monthly limit ${formatMoney(l.amount, a.currency)}`}</s-text>
              <s-text tone={pct != null && pct >= 100 ? "critical" : pct != null && pct >= 80 ? "caution" : undefined}>
                {pct != null ? `${formatMoney(l.spent!, a.currency)} spent this month (${pct}%).` : "Spend this month is read within the hour."}
                {l.pause ? " Running campaigns pause when it's reached." : " You'll be emailed at 80% and 100%."}
              </s-text>
            </s-stack>
          ) : (
            <s-text color="subdued">No monthly spend limit. Set one to be emailed at 80% and 100%, and optionally pause campaigns when it&apos;s reached.</s-text>
          )}
          <s-button onClick={() => setEditing(true)}>{l ? "Change limit" : "Set a monthly limit"}</s-button>
        </s-stack>
      </s-box>
    );
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="base">
        {error && <s-banner tone="warning">{error}</s-banner>}
        <s-number-field
          label={`Monthly spend limit (${a.currency})`}
          details="Leave empty for no limit. Checked every hour against this calendar month's spend."
          min={0}
          step={1}
          value={amount}
          onInput={(e) => setAmount(e.currentTarget.value)}
        />
        <s-checkbox
          label="Pause running campaigns when the limit is reached"
          details="Each campaign you switch back on afterwards is left running for the rest of the month."
          checked={pause}
          onChange={(e) => setPause(e.currentTarget.checked)}
        />
        <s-stack direction="inline" gap="small">
          <s-button variant="primary" loading={act.state !== "idle"} onClick={() => act.submit({ intent: "limit", account: a.id, amount, pause: String(pause) }, { method: "post" })}>
            Save limit
          </s-button>
          <s-button variant="tertiary" onClick={() => setEditing(false)}>
            Cancel
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function Campaigns({ a }: { a: AccountView }) {
  if (!a.campaigns.length) return <s-paragraph>No campaigns in this ad account yet.</s-paragraph>;
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Campaign</s-table-header>
        <s-table-header>Status</s-table-header>
        <s-table-header>Budget</s-table-header>
        <s-table-header format="numeric">Spend</s-table-header>
        <s-table-header format="numeric">Clicks</s-table-header>
        <s-table-header format="numeric">Purchases</s-table-header>
        <s-table-header format="numeric">Return</s-table-header>
        <s-table-header />
      </s-table-header-row>
      <s-table-body>
        {a.campaigns.map((c) => (
          <CampaignRow key={c.id} a={a} c={c} />
        ))}
      </s-table-body>
    </s-table>
  );
}

function CampaignRow({ a, c }: { a: AccountView; c: AccountView["campaigns"][number] }) {
  const act = useFetcher<typeof action>();
  const [editing, setEditing] = useEditor(act);
  const [amount, setAmount] = useState(c.budget != null ? String(c.budget) : "");
  const intent = act.formData?.get("intent");
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;
  // Show the switch as pressed straight away.
  const on = intent === "on" ? true : intent === "off" ? false : c.on;
  const budgetText = c.budget == null ? (a.network === "meta" ? "Set per ad set" : "Set per ad group") : `${formatMoney(c.budget, a.currency)} ${c.budgetKind === "daily" ? "a day" : "in total"}`;

  return (
    <s-table-row>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-text>{c.name}</s-text>
          {error && <s-text tone="critical">{error}</s-text>}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={on && c.delivery === "Running" ? "success" : on ? "warning" : "neutral"}>{on ? c.delivery : "Paused"}</s-badge>
      </s-table-cell>
      <s-table-cell>
        {editing ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-number-field label="New budget" labelAccessibilityVisibility="exclusive" prefix={a.currency} min={0} step={1} value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
            <s-button
              variant="primary"
              loading={act.state !== "idle" && intent === "budget"}
              onClick={() => act.submit({ intent: "budget", account: a.id, campaign: c.id, amount }, { method: "post" })}
            >
              Save
            </s-button>
            <s-button variant="tertiary" onClick={() => setEditing(false)}>
              Cancel
            </s-button>
          </s-stack>
        ) : c.budgetKind === "none" ? (
          <s-text color="subdued">{budgetText}</s-text>
        ) : (
          <s-button variant="tertiary" onClick={() => setEditing(true)}>
            {budgetText}
          </s-button>
        )}
      </s-table-cell>
      <s-table-cell>{formatMoney(c.spend, a.currency)}</s-table-cell>
      <s-table-cell>{whole(c.clicks)}</s-table-cell>
      <s-table-cell>{whole(c.purchases)}</s-table-cell>
      <s-table-cell>{roas(c)}</s-table-cell>
      <s-table-cell>
        <s-button
          variant="secondary"
          tone={on ? "critical" : undefined}
          loading={act.state !== "idle" && (intent === "on" || intent === "off")}
          onClick={() => act.submit({ intent: on ? "off" : "on", account: a.id, campaign: c.id }, { method: "post" })}
        >
          {on ? "Pause" : "Switch on"}
        </s-button>
      </s-table-cell>
    </s-table-row>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
