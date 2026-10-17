import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { compact, formatPrice } from "../lib/format";
import { gapClient } from "../lib/traffic/dataforseo.server";
import { keywordGap, refreshGap, setShopDomain, type GapRow } from "../lib/traffic/gap.server";

// The keyword gap: Google searches that bring competitors visits where the
// shop's website doesn't rank, or ranks below them.

const SHOWN = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { searchOn: gapClient() != null, ...(await keywordGap(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "domain") {
    const domain = await setShopDomain(session.shop, String(form.get("domain") ?? ""));
    return domain == null ? { error: "Enter your store's website, like yourstore.com." } : { ok: true as const };
  }
  const competitors = await db.competitor.findMany({ where: { shop: session.shop }, select: { id: true } });
  for (const c of competitors) await refreshGap(c.id, { force: true });
  return { ok: true as const };
};

const TABS = [
  { key: "missing", label: "You don't rank" },
  { key: "behind", label: "They rank higher" },
  { key: "ahead", label: "You rank higher" },
] as const;

export default function Keywords() {
  const data = useLoaderData<typeof loader>();
  const { searchOn, domain, market, competitors, totals } = data;
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("show")) ?? TABS[0];
  const rows = data[tab.key];
  const refresh = useFetcher<typeof action>();
  const waiting = competitors.filter((c) => !c.ready && !c.error);
  const failed = competitors.filter((c) => c.error);

  return (
    <s-page heading="Keyword gap">
      {searchOn && domain && competitors.length > 0 && (
        <s-button
          slot="primary-action"
          loading={refresh.state !== "idle"}
          onClick={() => refresh.submit({ intent: "refresh" }, { method: "post" })}
        >
          Refresh
        </s-button>
      )}

      {!searchOn && <s-banner tone="info">Search data isn&apos;t switched on for this store yet.</s-banner>}
      {failed.map((c) => (
        <s-banner key={c.id} tone="warning">
          {c.name}: {c.error}
        </s-banner>
      ))}

      <WebsiteSection domain={domain} />

      {!domain ? null : competitors.length === 0 ? (
        <s-section>
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
              <Stat label="Searches you don't rank for" value={totals.missing.toLocaleString()} />
              <Stat label="Monthly searches for them" value={compact(totals.missingSearches)} />
              <Stat label="Visits they get from them a month" value={compact(totals.missingVisits)} />
              <Stat label="Searches they rank higher for" value={totals.behind.toLocaleString()} />
            </s-grid>
            <s-box paddingBlockStart="base">
              <s-text color="subdued">
                Google searches in {market}, from each competitor&apos;s top 50 by visits. Updated weekly.
                {waiting.length > 0 && ` Still working out ${waiting.map((c) => c.name).join(", ")}.`}
              </s-text>
            </s-box>
          </s-section>

          <s-section>
            <s-stack gap="base">
              <s-stack direction="inline" gap="small">
                {TABS.map((t) => (
                  <s-button
                    key={t.key}
                    variant={t.key === tab.key ? "primary" : "secondary"}
                    onClick={() => setParams(t.key === "missing" ? {} : { show: t.key })}
                  >
                    {t.label} ({data[t.key].length})
                  </s-button>
                ))}
              </s-stack>
              {rows.length === 0 ? (
                <s-paragraph>No searches here yet.</s-paragraph>
              ) : (
                <GapTable rows={rows.slice(0, SHOWN)} showYours={tab.key !== "missing"} />
              )}
              {rows.length > SHOWN && (
                <s-text color="subdued">Showing the top {SHOWN} of {rows.length}.</s-text>
              )}
            </s-stack>
          </s-section>
        </>
      )}
    </s-page>
  );
}

function WebsiteSection({ domain }: { domain: string | null }) {
  const fetcher = useFetcher<typeof action>();
  const [value, setValue] = useState(domain ?? "");
  const error = fetcher.state === "idle" && fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return (
    <s-section heading="Your website">
      <s-stack gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        {!domain && (
          <s-paragraph>
            Enter the website your customers find you on, so Similarwise can compare it with your competitors.
          </s-paragraph>
        )}
        <s-stack direction="inline" gap="small" alignItems="end">
          <s-text-field
            label="Website"
            placeholder="yourstore.com"
            value={value}
            onInput={(e) => setValue(e.currentTarget.value)}
          />
          <s-button
            loading={fetcher.state !== "idle"}
            disabled={value.trim() === (domain ?? "")}
            onClick={() => fetcher.submit({ intent: "domain", domain: value }, { method: "post" })}
          >
            Save
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function GapTable({ rows, showYours }: { rows: GapRow[]; showYours: boolean }) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Search</s-table-header>
        <s-table-header format="numeric">Monthly searches</s-table-header>
        {showYours && <s-table-header format="numeric">Your position</s-table-header>}
        <s-table-header>Who ranks</s-table-header>
        <s-table-header format="numeric">Their visits a month</s-table-header>
        <s-table-header format="numeric">Cost per click</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((r) => (
          <s-table-row key={r.keyword}>
            <s-table-cell>{r.keyword}</s-table-cell>
            <s-table-cell>{r.searchVolume == null ? "–" : r.searchVolume.toLocaleString()}</s-table-cell>
            {showYours && <s-table-cell>{r.yourPosition ?? "–"}</s-table-cell>}
            <s-table-cell>
              <s-stack gap="small-200">
                {r.competitors.map((c) => (
                  <s-text key={c.id}>
                    {c.url ? (
                      <s-link href={c.url} target="_blank">
                        {c.name}
                      </s-link>
                    ) : (
                      c.name
                    )}
                    {c.position != null && <s-text color="subdued"> #{c.position}</s-text>}
                  </s-text>
                ))}
              </s-stack>
            </s-table-cell>
            <s-table-cell>{compact(r.competitors.reduce((n, c) => n + (c.traffic ?? 0), 0))}</s-table-cell>
            <s-table-cell>{r.cpcCents == null ? "–" : formatPrice(r.cpcCents, "USD")}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
