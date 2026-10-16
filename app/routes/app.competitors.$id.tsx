import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkCompetitor, parseStoredList } from "../lib/tracker/check.server";
import { EVENT_LABEL, EVENT_TONE, formatPrice, timeAgo } from "../lib/format";

// One competitor: what their store runs, the ad channels they're set up for,
// their catalogue over time, their latest changes and newest products.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const c = await db.competitor.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!c) throw new Response("Not found", { status: 404 });
  const [events, newest, snapshots, onSale] = await Promise.all([
    db.competitorEvent.findMany({ where: { competitorId: c.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.competitorProduct.findMany({
      where: { competitorId: c.id, removedAt: null },
      orderBy: [{ publishedAt: "desc" }, { firstSeenAt: "desc" }],
      take: 25,
    }),
    db.competitorSnapshot.findMany({ where: { competitorId: c.id }, orderBy: { takenAt: "desc" }, take: 14 }),
    db.competitorProduct.count({ where: { competitorId: c.id, removedAt: null, compareAtCents: { not: null } } }),
  ]);
  return {
    competitor: {
      id: c.id,
      name: c.name,
      url: c.url,
      isShopify: c.isShopify,
      theme: c.theme,
      currency: c.currency,
      apps: parseStoredList(c.apps),
      adChannels: parseStoredList(c.adChannels),
      productCount: c.productCount,
      avgPriceCents: c.avgPriceCents,
      onSale,
      lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
      lastError: c.lastError,
    },
    events: events.map((e) => ({ id: e.id, kind: e.kind, message: e.message, createdAt: e.createdAt.toISOString() })),
    newest: newest.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      productType: p.productType,
      priceCents: p.priceCents,
      compareAtCents: p.compareAtCents,
      publishedAt: (p.publishedAt ?? p.firstSeenAt).toISOString(),
    })),
    snapshots: snapshots.map((s) => ({
      id: s.id,
      takenAt: s.takenAt.toISOString(),
      productCount: s.productCount,
      avgPriceCents: s.avgPriceCents,
      onSaleCount: s.onSaleCount,
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const c = await db.competitor.findFirst({ where: { id: params.id, shop: session.shop }, select: { id: true } });
  if (!c) throw new Response("Not found", { status: 404 });
  await checkCompetitor(c.id);
  return { ok: true };
};

export default function Competitor() {
  const { competitor: c, events, newest, snapshots } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const checking = fetcher.state !== "idle";
  const price = (cents: number | null) => (cents == null ? "–" : formatPrice(cents, c.currency));

  return (
    <s-page heading={c.name}>
      <s-link slot="breadcrumb-actions" href="/app/competitors">
        Competitors
      </s-link>
      <s-button slot="primary-action" onClick={() => fetcher.submit({}, { method: "post" })} loading={checking}>
        Check now
      </s-button>
      <s-button slot="secondary-actions" href={c.url} target="_blank">
        Visit store
      </s-button>

      {c.lastError && <s-banner tone="warning">{c.lastError}</s-banner>}

      <s-section heading="Store">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Stat label="Platform" value={c.isShopify ? "Shopify" : c.lastCheckedAt ? "Not Shopify" : "–"} />
          <Stat label="Theme" value={c.theme ?? "–"} />
          <Stat label="Products" value={c.isShopify ? c.productCount.toLocaleString() : "–"} />
          <Stat label="Average price" value={price(c.avgPriceCents)} />
          <Stat label="On sale" value={c.isShopify ? c.onSale.toLocaleString() : "–"} />
        </s-grid>
        <s-box paddingBlockStart="base">
          <s-text color="subdued">Last checked {timeAgo(c.lastCheckedAt)}. Checked again every day.</s-text>
        </s-box>
      </s-section>

      <s-section heading="Ad and analytics channels">
        <s-stack gap="base">
          <s-paragraph>
            The tracking pixels on their store show which ad platforms they&apos;re set up to advertise on.
          </s-paragraph>
          <Badges items={c.adChannels} empty="No ad pixels seen on their home page." />
        </s-stack>
      </s-section>

      <s-section heading="Apps">
        <Badges items={c.apps} empty="No well-known apps seen on their home page." />
      </s-section>

      <s-section heading="Latest changes">
        {events.length === 0 ? (
          <s-paragraph>Nothing yet.</s-paragraph>
        ) : (
          <s-stack gap="small">
            {events.map((e) => (
              <s-stack key={e.id} direction="inline" gap="small" alignItems="center">
                <s-badge tone={EVENT_TONE[e.kind] ?? "neutral"}>{EVENT_LABEL[e.kind] ?? e.kind}</s-badge>
                <s-text>{e.message}</s-text>
                <s-text color="subdued">{timeAgo(e.createdAt)}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      {c.isShopify && (
        <s-section heading="Newest products">
          {newest.length === 0 ? (
            <s-paragraph>No products found.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Product</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header format="numeric">Price</s-table-header>
                <s-table-header>Published</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {newest.map((p) => (
                  <s-table-row key={p.id}>
                    <s-table-cell>
                      <s-link href={`${c.url}/products/${p.handle}`} target="_blank">
                        {p.title}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{p.productType ?? "–"}</s-table-cell>
                    <s-table-cell>
                      {price(p.priceCents)}
                      {p.compareAtCents ? <s-text color="subdued"> was {price(p.compareAtCents)}</s-text> : null}
                    </s-table-cell>
                    <s-table-cell>{timeAgo(p.publishedAt)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      )}

      {c.isShopify && snapshots.length > 1 && (
        <s-section heading="Catalogue over time">
          <s-table>
            <s-table-header-row>
              <s-table-header>Checked</s-table-header>
              <s-table-header format="numeric">Products</s-table-header>
              <s-table-header format="numeric">Average price</s-table-header>
              <s-table-header format="numeric">On sale</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {snapshots.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>{new Date(s.takenAt).toLocaleDateString()}</s-table-cell>
                  <s-table-cell>{s.productCount.toLocaleString()}</s-table-cell>
                  <s-table-cell>{price(s.avgPriceCents)}</s-table-cell>
                  <s-table-cell>{s.onSaleCount.toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

function Badges({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <s-paragraph>{empty}</s-paragraph>;
  return (
    <s-stack direction="inline" gap="small">
      {items.map((x) => (
        <s-badge key={x}>{x}</s-badge>
      ))}
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
