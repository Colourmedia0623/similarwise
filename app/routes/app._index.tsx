import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { overview } from "../lib/dashboard.server";
import { EVENT_LABEL, EVENT_TONE, formatPrice, timeAgo } from "../lib/format";

// Overview: what the shop's competitors changed this week, the ad channels
// each one is set up for, and the latest activity.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return overview(session.shop);
};

export default function Index() {
  const { competitors, week, recent } = useLoaderData<typeof loader>();

  if (competitors.length === 0) {
    return (
      <s-page heading="Similarwise">
        <s-section heading="See what your competitors are doing">
          <s-stack gap="base">
            <s-paragraph>
              Add the stores you compete with. Similarwise checks them every day and tells you when they launch
              products, change prices, or start advertising on a new channel.
            </s-paragraph>
            <s-button variant="primary" href="/app/competitors">
              Add your first competitor
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Similarwise">
      <s-button slot="primary-action" variant="primary" href="/app/competitors">
        Manage competitors
      </s-button>

      <s-section heading="This week">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Stat label="New products" value={week.launches} />
          <Stat label="Price changes" value={week.priceChanges} />
          <Stat label="Products taken down" value={week.removed} />
          <Stat label="Ad channel changes" value={week.channelChanges} />
        </s-grid>
      </s-section>

      <s-section heading="Your competitors">
        <s-table>
          <s-table-header-row>
            <s-table-header>Competitor</s-table-header>
            <s-table-header>Ad and analytics channels</s-table-header>
            <s-table-header format="numeric">Products</s-table-header>
            <s-table-header format="numeric">Average price</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {competitors.map((c) => (
              <s-table-row key={c.id}>
                <s-table-cell>
                  <s-link href={`/app/competitors/${c.id}`}>{c.name}</s-link>
                  {c.lastError ? <s-text tone="critical"> Check failed</s-text> : null}
                </s-table-cell>
                <s-table-cell>{c.adChannels.length ? c.adChannels.join(", ") : "None seen"}</s-table-cell>
                <s-table-cell>{c.productCount.toLocaleString()}</s-table-cell>
                <s-table-cell>{c.avgPriceCents != null ? formatPrice(c.avgPriceCents, c.currency) : "–"}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Latest activity">
        {recent.length === 0 ? (
          <s-paragraph>Nothing has changed yet. Similarwise checks each competitor once a day.</s-paragraph>
        ) : (
          <s-stack gap="small">
            {recent.map((e) => (
              <s-stack key={e.id} direction="inline" gap="small" alignItems="center">
                <s-badge tone={EVENT_TONE[e.kind] ?? "neutral"}>{EVENT_LABEL[e.kind] ?? e.kind}</s-badge>
                <s-link href={`/app/competitors/${e.competitor.id}`}>{e.competitor.name}</s-link>
                <s-text>{e.message}</s-text>
                <s-text color="subdued">{timeAgo(e.createdAt)}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value.toLocaleString()}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
