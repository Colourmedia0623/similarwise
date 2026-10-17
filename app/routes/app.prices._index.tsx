import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { formatPrice } from "../lib/format";
import { describeGap } from "../lib/prices/match";
import { confirmMatch, priceComparison, suggestMatches, syncIfStale, syncShopProducts, type Graphql } from "../lib/prices/prices.server";

// The shop's products next to the same products at each competitor, with how
// much cheaper or dearer they sell them.

const graphqlFor =
  (admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]): Graphql =>
  async (query, variables) =>
    (await admin.graphql(query, { variables })).json();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  let syncError: string | null = null;
  try {
    await syncIfStale(session.shop, graphqlFor(admin));
  } catch (e) {
    console.error("Product sync failed", session.shop, e);
    syncError = "Similarwise couldn't read your products. Reopen the app and approve product access, then try again.";
  }
  await suggestMatches(session.shop);
  return { syncError, ...(await priceComparison(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "confirm") {
    await confirmMatch(session.shop, String(form.get("matchId") ?? ""));
    return { ok: true };
  }
  try {
    await syncShopProducts(session.shop, graphqlFor(admin));
    await suggestMatches(session.shop);
    return { ok: true };
  } catch (e) {
    console.error("Product sync failed", session.shop, e);
    return { ok: false };
  }
};

export default function Prices() {
  const { syncError, competitors, rows, totals } = useLoaderData<typeof loader>();
  const sync = useFetcher<typeof action>();
  const [params, setParams] = useSearchParams();
  const undercutOnly = params.get("show") === "undercut";
  const shown = undercutOnly
    ? rows.filter((r) => r.cells.some((c) => c && !c.removed && c.gap != null && c.gap < 0))
    : rows;
  const avg = totals.averageGap == null ? "–" : `${totals.averageGap > 0 ? "+" : ""}${Math.round(totals.averageGap * 100)}%`;

  return (
    <s-page heading="Price comparison">
      <s-button
        slot="primary-action"
        loading={sync.state !== "idle"}
        onClick={() => sync.submit({ intent: "sync" }, { method: "post" })}
      >
        Refresh my products
      </s-button>

      {syncError && <s-banner tone="warning">{syncError}</s-banner>}
      {sync.data && !sync.data.ok && <s-banner tone="critical">Couldn&apos;t refresh your products. Try again.</s-banner>}

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Stat label="Your products" value={totals.products.toLocaleString()} />
          <Stat label="Matched at a competitor" value={totals.matched.toLocaleString()} />
          <Stat label="A competitor is cheaper" value={totals.undercut.toLocaleString()} />
          <Stat label="You're cheapest" value={totals.cheapest.toLocaleString()} />
          <Stat label="Competitors vs you, on average" value={avg} />
        </s-grid>
      </s-section>

      <s-section heading="Your products against your competitors">
        {competitors.length === 0 ? (
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        ) : rows.length === 0 ? (
          <s-paragraph>
            No matches yet. Similarwise suggests a match when a competitor sells a product with a very similar name. Open
            any product to pick its match by hand.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-stack direction="inline" gap="small">
              <s-button variant={undercutOnly ? "secondary" : "primary"} onClick={() => setParams({})}>
                All matched ({rows.length})
              </s-button>
              <s-button
                variant={undercutOnly ? "primary" : "secondary"}
                onClick={() => setParams({ show: "undercut" })}
              >
                A competitor is cheaper ({totals.undercut})
              </s-button>
            </s-stack>
            <s-paragraph>
              <s-text color="subdued">
                Matches marked Suggested were picked by name. Confirm them, or open a product to choose a different one.
              </s-text>
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Your product</s-table-header>
                <s-table-header format="numeric">Your price</s-table-header>
                {competitors.map((c) => (
                  <s-table-header key={c.id}>{c.name}</s-table-header>
                ))}
              </s-table-header-row>
              <s-table-body>
                {shown.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      <s-link href={`/app/prices/${r.id}`}>{r.title}</s-link>
                    </s-table-cell>
                    <s-table-cell>{formatPrice(r.priceCents, r.currency)}</s-table-cell>
                    {r.cells.map((c, i) => (
                      <s-table-cell key={competitors[i].id}>{c ? <PriceCell cell={c} /> : <s-text color="subdued">–</s-text>}</s-table-cell>
                    ))}
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

type CellData = NonNullable<Awaited<ReturnType<typeof loader>>["rows"][number]["cells"][number]>;

function PriceCell({ cell }: { cell: CellData }) {
  const confirm = useFetcher();
  const gap = describeGap(cell.gap);
  if (cell.removed) return <s-text color="subdued">No longer sold</s-text>;
  return (
    <s-stack gap="small-200">
      <s-link href={cell.url} target="_blank">
        {formatPrice(cell.priceCents, cell.currency)}
      </s-link>
      <s-stack direction="inline" gap="small-200">
        <s-badge tone={gap.tone}>{gap.label}</s-badge>
        {!cell.confirmed && (
          <s-button
            variant="tertiary"
            accessibilityLabel={`Confirm the match with ${cell.title}`}
            loading={confirm.state !== "idle"}
            onClick={() => confirm.submit({ intent: "confirm", matchId: cell.matchId }, { method: "post" })}
          >
            Suggested · Confirm
          </s-button>
        )}
      </s-stack>
      <s-text color="subdued">{cell.title}</s-text>
    </s-stack>
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
