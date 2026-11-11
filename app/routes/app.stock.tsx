import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { formatPrice, timeAgo } from "../lib/format";
import { soldOutProducts } from "../lib/tracker/stock.server";

// What's sold out at competitors right now, with the products the shop sells
// too first: while a rival is out of stock, their shoppers look elsewhere.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return soldOutProducts(session.shop);
};

export default function Stock() {
  const { competitors, rows, totals } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const only = params.get("competitor");
  const youSellOnly = params.get("show") === "yours";
  const shown = rows.filter((r) => (!only || r.competitor.id === only) && (!youSellOnly || r.yours));
  const shopify = competitors.filter((c) => c.isShopify);

  return (
    <s-page heading="Out of stock at competitors">
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Stat label="Products sold out" value={totals.soldOut.toLocaleString()} />
          <Stat label="Ones you sell too" value={totals.youSell.toLocaleString()} />
          {shopify.map((c) => (
            <Stat
              key={c.id}
              label={c.name}
              value={`${c.soldOut.toLocaleString()} of ${c.productCount.toLocaleString()}`}
            />
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Sold out now">
        {competitors.length === 0 ? (
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        ) : shopify.length === 0 ? (
          <s-paragraph>
            Stock can only be read from Shopify stores, and none of your competitors are on Shopify.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-stack direction="inline" gap="small">
              <s-button variant={!only && !youSellOnly ? "primary" : "secondary"} onClick={() => setParams({})}>
                All ({totals.soldOut})
              </s-button>
              <s-button variant={youSellOnly ? "primary" : "secondary"} onClick={() => setParams({ show: "yours" })}>
                You sell too ({totals.youSell})
              </s-button>
              {shopify.map((c) => (
                <s-button
                  key={c.id}
                  variant={only === c.id ? "primary" : "secondary"}
                  onClick={() => setParams({ competitor: c.id })}
                >
                  {c.name} ({c.soldOut})
                </s-button>
              ))}
            </s-stack>
            <s-paragraph>
              <s-text color="subdued">
                A product counts as sold out when every option of it is unavailable on their store. Checked every day.
                Products you sell too come from your matches on the{" "}
                <s-link href="/app/prices">Price comparison</s-link> page.
              </s-text>
            </s-paragraph>
            {shown.length === 0 ? (
              <s-paragraph>Nothing sold out right now.</s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Product</s-table-header>
                  <s-table-header>Competitor</s-table-header>
                  <s-table-header format="numeric">Their price</s-table-header>
                  <s-table-header>Sold out</s-table-header>
                  <s-table-header>You sell</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {shown.map((r) => (
                    <s-table-row key={r.id}>
                      <s-table-cell>
                        <s-link href={r.url} target="_blank">
                          {r.title}
                        </s-link>
                        {r.productType ? <s-text color="subdued"> {r.productType}</s-text> : null}
                      </s-table-cell>
                      <s-table-cell>
                        <s-link href={`/app/competitors/${r.competitor.id}`}>{r.competitor.name}</s-link>
                      </s-table-cell>
                      <s-table-cell>{formatPrice(r.priceCents, r.currency)}</s-table-cell>
                      <s-table-cell>{r.soldOutAt ? timeAgo(r.soldOutAt) : "–"}</s-table-cell>
                      <s-table-cell>
                        {r.yours ? (
                          <s-stack gap="small-200">
                            <s-badge tone="success">You have it</s-badge>
                            <s-link href={`/app/prices/${r.yours.id}`}>
                              {r.yours.title} · {formatPrice(r.yours.priceCents, r.yours.currency)}
                            </s-link>
                          </s-stack>
                        ) : (
                          <s-text color="subdued">–</s-text>
                        )}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        )}
      </s-section>
    </s-page>
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
