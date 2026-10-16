import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { MAX_COMPETITORS, addCompetitor, removeCompetitor } from "../lib/tracker/check.server";
import { timeAgo } from "../lib/format";
import { MARKETS } from "../lib/traffic/markets";
import { setShopMarket, shopMarket } from "../lib/traffic/refresh.server";
import { trafficClient } from "../lib/traffic/dataforseo.server";

// The competitors a shop tracks: add one by its website, or stop tracking one.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const competitors = await db.competitor.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, url: true, isShopify: true, productCount: true, lastCheckedAt: true, lastError: true },
  });
  return {
    market: (await shopMarket(session.shop)).code,
    markets: MARKETS.map((m) => ({ code: m.code, name: m.name })),
    searchOn: trafficClient() != null,
    max: MAX_COMPETITORS,
    competitors: competitors.map((c) => ({ ...c, lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "market") {
    await setShopMarket(session.shop, String(form.get("market") ?? ""));
    return { ok: true as const };
  }
  if (intent === "remove") {
    await removeCompetitor(session.shop, String(form.get("id") ?? ""));
    return { ok: true as const };
  }
  const result = await addCompetitor(session.shop, String(form.get("url") ?? ""));
  return "error" in result ? { error: result.error } : { ok: true as const, added: result.id };
};

export default function Competitors() {
  const { max, competitors, market, markets, searchOn } = useLoaderData<typeof loader>();
  const marketFetcher = useFetcher({ key: "market" });
  const fetcher = useFetcher<typeof action>({ key: "add-competitor" });
  const [url, setUrl] = useState("");
  const adding = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "add";
  const error = fetcher.state === "idle" && fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const full = competitors.length >= max;

  const add = () => {
    if (!url.trim()) return;
    fetcher.submit({ intent: "add", url }, { method: "post" });
    setUrl("");
  };

  return (
    <s-page heading="Competitors">
      <s-section heading="Add a competitor">
        <s-stack gap="base">
          {error && <s-banner tone="critical">{error}</s-banner>}
          {full ? (
            <s-paragraph>
              You&apos;re tracking {max} competitors, the most for now. Remove one to add another.
            </s-paragraph>
          ) : (
            <>
              <s-text-field
                label="Competitor's website"
                placeholder="rival.com"
                value={url}
                onInput={(e) => setUrl(e.currentTarget.value)}
              />
              <s-paragraph>
                {adding
                  ? "Checking their store. This can take a minute for big catalogues."
                  : "Similarwise reads their public store pages: products, prices, apps and the ad pixels they load."}
              </s-paragraph>
              <s-button variant="primary" onClick={add} loading={adding} disabled={!url.trim()}>
                Add competitor
              </s-button>
            </>
          )}
        </s-stack>
      </s-section>

      {searchOn && (
        <s-section heading="Market">
          <s-stack gap="base">
            <s-select
              label="Country for search traffic and Google Ads numbers"
              value={market}
              disabled={marketFetcher.state !== "idle"}
              onChange={(e) =>
                marketFetcher.submit(
                  { intent: "market", market: e.currentTarget.value },
                  { method: "post" },
                )
              }
            >
              {markets.map((m) => (
                <s-option key={m.code} value={m.code}>
                  {m.name}
                </s-option>
              ))}
            </s-select>
            {marketFetcher.state !== "idle" && <s-paragraph>Updating your competitors&apos; numbers…</s-paragraph>}
          </s-stack>
        </s-section>
      )}

      <s-section heading={`Tracking ${competitors.length} of ${max}`}>
        {competitors.length === 0 ? (
          <s-paragraph>No competitors yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Competitor</s-table-header>
              <s-table-header>Store</s-table-header>
              <s-table-header format="numeric">Products</s-table-header>
              <s-table-header>Last checked</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {competitors.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`/app/competitors/${c.id}`}>{c.name}</s-link>
                    <s-text color="subdued"> {c.url.replace("https://", "")}</s-text>
                  </s-table-cell>
                  <s-table-cell>{c.isShopify ? "Shopify" : c.lastCheckedAt ? "Not Shopify" : "–"}</s-table-cell>
                  <s-table-cell>{c.isShopify ? c.productCount.toLocaleString() : "–"}</s-table-cell>
                  <s-table-cell>
                    {c.lastError ? <s-text tone="critical">Failed {timeAgo(c.lastCheckedAt)}</s-text> : timeAgo(c.lastCheckedAt)}
                  </s-table-cell>
                  <s-table-cell>
                    <RemoveButton id={c.id} name={c.name} />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function RemoveButton({ id, name }: { id: string; name: string }) {
  const fetcher = useFetcher();
  return (
    <s-button
      variant="tertiary"
      tone="critical"
      loading={fetcher.state !== "idle"}
      accessibilityLabel={`Stop tracking ${name}`}
      onClick={() => {
        if (confirm(`Stop tracking ${name}? Its history will be deleted.`))
          fetcher.submit({ intent: "remove", id }, { method: "post" });
      }}
    >
      Remove
    </s-button>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
