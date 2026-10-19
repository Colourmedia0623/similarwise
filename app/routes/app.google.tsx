import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { formatPrice } from "../lib/format";
import { signState } from "../lib/social/seal.server";
import { isOwnerShop } from "../lib/waitlist.server";
import { formatCustomerId, type AdsTotals, type Totals } from "../lib/google/google";
import {
  adsOn,
  chooseSources,
  disconnectGoogle,
  googleApproved,
  googleAuthorizeUrl,
  googleChoices,
  googleOn,
  googleOverview,
  refreshGoogle,
  startGoogleRefresh,
} from "../lib/google/google.server";

// The shop's own Google Analytics and Google Ads figures, next to what
// competitors are estimated to spend on Google Ads.

const SIGN_IN_FOR = 30 * 60_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const open = googleOn() && (googleApproved() || isOwnerShop(shop));
  const connect = open ? googleAuthorizeUrl(signState({ shop, network: "google", exp: Date.now() + SIGN_IN_FOR })) : null;
  const overview = await googleOverview(shop);
  const choosing = !!overview && (new URL(request.url).searchParams.has("choose") || (!overview.gaProperty && !overview.adsCustomer));
  const [choices, competitors] = await Promise.all([
    choosing ? googleChoices(shop) : null,
    db.competitor.findMany({ where: { shop, paidCostCents: { gt: 0 } }, select: { name: true, url: true, paidCostCents: true }, orderBy: { paidCostCents: "desc" }, take: 10 }),
  ]);
  return { on: googleOn(), adsOn: adsOn(), connect, overview, choosing, choices, competitors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "disconnect") {
    await disconnectGoogle(shop);
    return { ok: true as const };
  }
  if (intent === "choose") {
    const choices = await googleChoices(shop);
    if (!choices) return { error: "Connect Google first." };
    const property = choices.properties.find((p) => p.id === form.get("property"));
    const account = choices.accounts.find((a) => a.id === form.get("account"));
    await chooseSources(shop, {
      gaProperty: property?.id ?? null,
      gaName: property?.name ?? null,
      adsCustomer: account?.id ?? null,
      adsLogin: account?.login ?? null,
      adsName: account?.name ?? null,
    });
    // The first read is quick, so wait for it rather than showing an empty page.
    await refreshGoogle(shop);
    return redirect("/app/google");
  }
  if (intent === "refresh") return (await startGoogleRefresh(shop)) ? { ok: true as const } : { error: "Those figures were read a few minutes ago. Try again shortly." };
  return { error: "Unknown action" };
};

const whole = (v: number) => Math.round(v).toLocaleString("en-GB");
const money = (v: number, currency: string) => formatPrice(Math.round(v * 100), currency);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return <s-text color="subdued">No change</s-text>;
  return <s-text tone={pct > 0 ? "success" : "critical"}>{`${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% on the period before`}</s-text>;
}

function Tiles({ tiles }: { tiles: { label: string; value: string; now: number; before: number }[] }) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
      {tiles.map((t) => (
        <s-box key={t.label} padding="base" background="subdued" borderRadius="base">
          <s-stack gap="small-200">
            <s-text color="subdued">{t.label}</s-text>
            <s-heading>{t.value}</s-heading>
            <Change now={t.now} before={t.before} />
          </s-stack>
        </s-box>
      ))}
    </s-grid>
  );
}

const gaTiles = (c: Totals, p: Totals, currency: string) => [
  { label: "Visits", value: whole(c.sessions), now: c.sessions, before: p.sessions },
  { label: "Visitors", value: whole(c.users), now: c.users, before: p.users },
  { label: "Orders", value: whole(c.purchases), now: c.purchases, before: p.purchases },
  { label: "Sales", value: money(c.revenue, currency), now: c.revenue, before: p.revenue },
];

const roas = (t: AdsTotals) => (t.spend ? t.value / t.spend : 0);
const adsTiles = (c: AdsTotals, p: AdsTotals, currency: string) => [
  { label: "Spend", value: money(c.spend, currency), now: c.spend, before: p.spend },
  { label: "Clicks", value: whole(c.clicks), now: c.clicks, before: p.clicks },
  { label: "Cost per click", value: c.clicks ? money(c.spend / c.clicks, currency) : "–", now: c.clicks ? c.spend / c.clicks : 0, before: p.clicks ? p.spend / p.clicks : 0 },
  { label: "Conversions", value: whole(c.conversions), now: c.conversions, before: p.conversions },
  { label: "Return on ad spend", value: c.spend ? `${roas(c).toFixed(1)}×` : "–", now: roas(c), before: roas(p) },
];

export default function Google() {
  const d = useLoaderData<typeof loader>();
  const act = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const o = d.overview;
  const report = o?.report;
  const busy = (intent: string) => act.state !== "idle" && act.formData?.get("intent") === intent;
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;
  const [property, setProperty] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const pickedProperty = property ?? o?.gaProperty ?? d.choices?.properties[0]?.id ?? "";
  const pickedAccount = account ?? o?.adsCustomer ?? d.choices?.accounts[0]?.id ?? "";

  // Signing in happens in another tab; pick up the connection on coming back.
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && revalidator.revalidate();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [revalidator]);

  // A refresh takes a few seconds; keep looking while it runs.
  useEffect(() => {
    if (!o?.running) return;
    const t = setInterval(() => revalidator.revalidate(), 5_000);
    return () => clearInterval(t);
  }, [o?.running, revalidator]);

  return (
    <s-page heading="Google Analytics and Ads">
      {o && !d.choosing && (
        <s-button slot="primary-action" loading={busy("refresh") || o.running} onClick={() => act.submit({ intent: "refresh" }, { method: "post" })}>
          Refresh
        </s-button>
      )}
      {!d.on && <s-banner tone="info">Connecting Google isn&apos;t switched on for this app yet.</s-banner>}
      {error && <s-banner tone="warning">{error}</s-banner>}

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Connect your Google account to see your store&apos;s real visits, where they come from and what sells, from Google Analytics, and what your
            Google Ads spend brings in, beside the estimates for your competitors. SimilarWise only reads these figures; it never changes anything in
            your Google accounts.
          </s-paragraph>
          {o ? (
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone="success">Connected</s-badge>
              <s-text>{o.email}</s-text>
              {!d.choosing && (
                <s-button variant="tertiary" href="/app/google?choose=1">
                  Change property or account
                </s-button>
              )}
              <s-button variant="tertiary" tone="critical" loading={busy("disconnect")} onClick={() => act.submit({ intent: "disconnect" }, { method: "post" })}>
                Disconnect
              </s-button>
            </s-stack>
          ) : d.connect ? (
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" href={d.connect} target="_blank">
                Connect Google
              </s-button>
            </s-stack>
          ) : (
            d.on && <s-button disabled>Connecting Google is coming soon</s-button>
          )}
          {!o && d.connect && <s-text color="subdued">Signing in opens in a new tab. Tick Analytics and Google Ads on Google&apos;s page so SimilarWise can read both.</s-text>}
          {o?.checkedAt && !d.choosing && <s-text color="subdued">Last read {day(o.checkedAt)}. Read again every day.</s-text>}
        </s-stack>
      </s-section>

      {o && d.choosing && d.choices && (
        <s-section heading="What to show">
            <s-stack gap="base">
              {o.analyticsAllowed ? (
                d.choices.propertiesError ? (
                  <s-banner tone="warning">{d.choices.propertiesError}</s-banner>
                ) : d.choices.properties.length ? (
                  <s-select label="Google Analytics property" value={pickedProperty} onChange={(e) => setProperty(e.currentTarget.value)}>
                    {d.choices.properties.map((p) => (
                      <s-option key={p.id} value={p.id}>
                        {p.group ? `${p.name} (${p.group})` : p.name}
                      </s-option>
                    ))}
                    <s-option value="">Don&apos;t show Analytics</s-option>
                  </s-select>
                ) : (
                  <s-text color="subdued">This Google account has no Google Analytics 4 properties.</s-text>
                )
              ) : (
                <s-text color="subdued">Analytics wasn&apos;t ticked when you signed in. Disconnect and connect again to add it.</s-text>
              )}
              {!d.adsOn ? (
                <s-text color="subdued">Google Ads isn&apos;t switched on for this app yet.</s-text>
              ) : o.adsAllowed ? (
                d.choices.accountsError ? (
                  <s-banner tone="warning">{d.choices.accountsError}</s-banner>
                ) : d.choices.accounts.length ? (
                  <s-select label="Google Ads account" value={pickedAccount} onChange={(e) => setAccount(e.currentTarget.value)}>
                    {d.choices.accounts.map((a) => (
                      <s-option key={a.id} value={a.id}>
                        {`${a.name} (${formatCustomerId(a.id)})${a.group ? `, through ${a.group}` : ""}`}
                      </s-option>
                    ))}
                    <s-option value="">Don&apos;t show Google Ads</s-option>
                  </s-select>
                ) : (
                  <s-text color="subdued">This Google account has no Google Ads accounts.</s-text>
                )
              ) : (
                <s-text color="subdued">Google Ads wasn&apos;t ticked when you signed in. Disconnect and connect again to add it.</s-text>
              )}
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  loading={busy("choose")}
                  onClick={() => act.submit({ intent: "choose", property: pickedProperty, account: pickedAccount }, { method: "post" })}
                >
                  Show these
                </s-button>
                {(o.gaProperty || o.adsCustomer) && (
                  <s-button variant="tertiary" href="/app/google">
                    Cancel
                  </s-button>
                )}
              </s-stack>
            </s-stack>
        </s-section>
      )}

      {o && !d.choosing && o.gaProperty && (
        <s-section heading={`Google Analytics: ${o.gaName ?? "your store"}, last 28 days`}>
          {report?.analyticsError ? (
            <s-banner tone="warning">{report.analyticsError}</s-banner>
          ) : report?.analytics ? (
            <s-stack gap="large">
              <Tiles tiles={gaTiles(report.analytics.current, report.analytics.previous, report.analytics.currency)} />
              {report.analytics.channels.length > 0 && (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Where visits come from</s-table-header>
                    <s-table-header format="numeric">Visits</s-table-header>
                    <s-table-header format="numeric">Share</s-table-header>
                    <s-table-header format="numeric">Sales</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {report.analytics.channels.map((c) => (
                      <s-table-row key={c.name}>
                        <s-table-cell>{c.name}</s-table-cell>
                        <s-table-cell>{whole(c.sessions)}</s-table-cell>
                        <s-table-cell>{report.analytics!.current.sessions ? `${Math.round((c.sessions / report.analytics!.current.sessions) * 100)}%` : "–"}</s-table-cell>
                        <s-table-cell>{money(c.revenue, report.analytics!.currency)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
              {report.analytics.pages.length > 0 && (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Top landing pages</s-table-header>
                    <s-table-header format="numeric">Visits</s-table-header>
                    <s-table-header format="numeric">Orders</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {report.analytics.pages.map((p) => (
                      <s-table-row key={p.path}>
                        <s-table-cell>{p.path}</s-table-cell>
                        <s-table-cell>{whole(p.sessions)}</s-table-cell>
                        <s-table-cell>{whole(p.purchases)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          ) : (
            <s-text color="subdued">Reading your figures…</s-text>
          )}
        </s-section>
      )}

      {o && !d.choosing && o.adsCustomer && (
        <s-section heading={`Google Ads: ${o.adsName ?? "your account"}, last 30 days`}>
          {report?.adsError ? (
            <s-banner tone="warning">{report.adsError}</s-banner>
          ) : report?.ads ? (
            <s-stack gap="large">
              <Tiles tiles={adsTiles(report.ads.current, report.ads.previous, report.ads.currency)} />
              {report.ads.campaigns.length > 0 ? (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Campaign</s-table-header>
                    <s-table-header format="numeric">Spend</s-table-header>
                    <s-table-header format="numeric">Clicks</s-table-header>
                    <s-table-header format="numeric">Conversions</s-table-header>
                    <s-table-header format="numeric">Return on spend</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {report.ads.campaigns.map((c) => (
                      <s-table-row key={c.name}>
                        <s-table-cell>{c.name}</s-table-cell>
                        <s-table-cell>{money(c.spend, report.ads!.currency)}</s-table-cell>
                        <s-table-cell>{whole(c.clicks)}</s-table-cell>
                        <s-table-cell>{whole(c.conversions)}</s-table-cell>
                        <s-table-cell>{c.spend ? `${roas(c).toFixed(1)}×` : "–"}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              ) : (
                <s-text color="subdued">No campaigns spent anything in the last 30 days.</s-text>
              )}
            </s-stack>
          ) : (
            <s-text color="subdued">Reading your figures…</s-text>
          )}
        </s-section>
      )}

      {d.competitors.length > 0 && (
        <s-section heading="What competitors spend on Google Ads">
          <s-stack gap="base">
            <s-paragraph>
              Estimated monthly Google search ads spend, from DataForSEO{report?.ads ? ", beside your own spend over the last 30 days" : ""}.
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Store</s-table-header>
                <s-table-header format="numeric">Google Ads spend a month</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {report?.ads && (
                  <s-table-row>
                    <s-table-cell>
                      <s-text type="strong">You</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text type="strong">{money(report.ads.current.spend, report.ads.currency)}</s-text>
                    </s-table-cell>
                  </s-table-row>
                )}
                {d.competitors.map((c) => (
                  <s-table-row key={c.url}>
                    <s-table-cell>{c.name}</s-table-cell>
                    <s-table-cell>{formatPrice(c.paidCostCents!, "USD")}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
