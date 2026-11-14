import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { formatPrice, timeAgo } from "../lib/format";
import { checkStockNow, soldOutProducts } from "../lib/tracker/stock.server";
import { HowTo } from "../components/HowTo";

// What's showing out of stock at competitors right now, sold out entirely or
// in some sizes and options, with the products the shop sells too first:
// while a rival is out of stock, their shoppers look elsewhere.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return soldOutProducts(session.shop);
};

// Big catalogues take minutes to read, so the check runs on after the reply.
const checking = new Set<string>();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  if (!checking.has(shop)) {
    checking.add(shop);
    checkStockNow(shop)
      .catch((err) => console.error(`Couldn't check stock for ${shop}`, err))
      .finally(() => checking.delete(shop));
  }
  return { started: true };
};

export default function Stock() {
  const { competitors, rows, totals, checkedAt } = useLoaderData<typeof loader>();
  const check = useFetcher<typeof action>();
  const [params, setParams] = useSearchParams();
  const only = params.get("competitor");
  const show = params.get("show");
  const shown = rows.filter(
    (r) =>
      (!only || r.competitor.id === only) &&
      (show !== "yours" || r.yours) &&
      (show !== "sold-out" || r.soldOut) &&
      (show !== "partly" || !r.soldOut),
  );
  const shopify = competitors.filter((c) => c.isShopify);
  const filter = (next: Record<string, string>) => setParams(next);

  return (
    <s-page heading="Out of stock at competitors">
      <HowTo video="out-of-stock" />
      <s-button
        slot="primary-action"
        loading={check.state !== "idle"}
        disabled={check.data?.started}
        onClick={() => check.submit({}, { method: "post" })}
      >
        Check stock now
      </s-button>
      {check.data?.started && (
        <s-banner tone="info">
          Checking your competitors&apos; stores now. Big catalogues take a few minutes: reload this page shortly.
        </s-banner>
      )}
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Stat label="Sold out completely" value={totals.soldOut.toLocaleString()} />
          <Stat label="Some sizes or options out" value={totals.partly.toLocaleString()} />
          <Stat label="Ones you sell too" value={totals.youSell.toLocaleString()} />
          {shopify.map((c) => (
            <Stat
              key={c.id}
              label={`${c.name} (${c.productCount.toLocaleString()} products)`}
              value={`${c.soldOut.toLocaleString()} out, ${c.partly.toLocaleString()} partly`}
            />
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Showing out of stock now">
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
              <s-button variant={!only && !show ? "primary" : "secondary"} onClick={() => filter({})}>
                All ({rows.length})
              </s-button>
              <s-button variant={show === "sold-out" ? "primary" : "secondary"} onClick={() => filter({ show: "sold-out" })}>
                Sold out completely ({totals.soldOut})
              </s-button>
              <s-button variant={show === "partly" ? "primary" : "secondary"} onClick={() => filter({ show: "partly" })}>
                Some sizes out ({totals.partly})
              </s-button>
              <s-button variant={show === "yours" ? "primary" : "secondary"} onClick={() => filter({ show: "yours" })}>
                You sell too ({totals.youSell})
              </s-button>
              {shopify.map((c) => (
                <s-button
                  key={c.id}
                  variant={only === c.id ? "primary" : "secondary"}
                  onClick={() => filter({ competitor: c.id })}
                >
                  {c.name} ({c.soldOut + c.partly})
                </s-button>
              ))}
            </s-stack>
            <s-paragraph>
              <s-text color="subdued">
                What their store shows as sold out: the whole product, or some of its sizes and options. Checked every
                day{checkedAt ? `, last ${timeAgo(checkedAt)}` : ""}.
                Products you sell too come from your matches on the{" "}
                <s-link href="/app/prices">Price comparison</s-link> page.
              </s-text>
            </s-paragraph>
            {shown.length === 0 ? (
              <s-paragraph>
                Nothing showing out of stock{checkedAt ? "" : " yet"}. Stock is read on each check: press Check stock now
                to read it straight away.
              </s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Product</s-table-header>
                  <s-table-header>Competitor</s-table-header>
                  <s-table-header format="numeric">Their price</s-table-header>
                  <s-table-header>What&apos;s out</s-table-header>
                  <s-table-header>Since</s-table-header>
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
                      <s-table-cell>
                        {r.soldOut ? (
                          <s-badge tone="critical">Sold out</s-badge>
                        ) : (
                          <s-stack gap="small-200">
                            <s-badge tone="warning">
                              {`${r.soldOutOptions.length} of ${r.variantCount || r.soldOutOptions.length} options out`}
                            </s-badge>
                            <s-text color="subdued">{optionList(r.soldOutOptions)}</s-text>
                          </s-stack>
                        )}
                      </s-table-cell>
                      <s-table-cell>{r.soldOut && r.soldOutAt ? timeAgo(r.soldOutAt) : "–"}</s-table-cell>
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

function optionList(options: string[]) {
  return options.length > 6 ? `${options.slice(0, 6).join(", ")} and ${options.length - 6} more` : options.join(", ");
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
