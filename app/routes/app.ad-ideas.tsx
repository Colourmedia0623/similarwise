import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Copyable } from "../components/Copyable";
import { adIdeas, adIdeasClient, refreshAdIdeas } from "../lib/ideas/ad-ideas.server";
import { syncIfStale, type Graphql } from "../lib/prices/prices.server";

// Ad ideas: what competitors' running ads keep saying, and ads the shop could
// run for its own products.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: adIdeasClient() != null, ...(await adIdeas(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  await syncIfStale(session.shop, graphql).catch((err) => console.error("Product sync failed", session.shop, err));
  try {
    return await refreshAdIdeas(session.shop);
  } catch (err) {
    console.error("Couldn't write ad ideas", session.shop, err);
    return { error: "Couldn't write ideas just now. Try again in a minute." };
  }
};

const PLATFORM = { meta: "Facebook and Instagram", tiktok: "TikTok" } as const;

export default function AdIdeas() {
  const { on, patterns, ideas, adsRead, createdAt } = useLoaderData<typeof loader>();
  const write = useFetcher<typeof action>();
  const busy = write.state !== "idle";
  const error = write.data && "error" in write.data ? write.data.error : null;
  return (
    <s-page heading="Ad ideas">
      {on && (
        <s-button slot="primary-action" loading={busy} onClick={() => write.submit({}, { method: "post" })}>
          {ideas.length ? "Write new ideas" : "Write ideas"}
        </s-button>
      )}
      {!on && <s-banner tone="info">Ad ideas aren&apos;t switched on for this app yet.</s-banner>}
      {error && <s-banner tone="warning">{error}</s-banner>}

      <s-section>
        <s-paragraph>
          What your competitors&apos; running <s-link href="/app/ads">ads</s-link> keep coming back to, and ads you could run for your own
          products. The ads that have run longest count most, since they&apos;re likely the ones that work. Writing them takes about a minute.
        </s-paragraph>
        {createdAt && (
          <s-text color="subdued">
            Written {new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} from {adsRead} ads.
          </s-text>
        )}
      </s-section>

      {ideas.length === 0 && on && !busy && (
        <s-section>
          <s-paragraph>No ideas yet. Press Write ideas to get some.</s-paragraph>
        </s-section>
      )}

      {patterns.length > 0 && (
        <s-section heading="What competitors' ads keep saying">
          <s-stack gap="base">
            {patterns.map((p) => (
              <s-stack key={p.theme} gap="small-200">
                <s-heading>{p.theme}</s-heading>
                <s-text>{p.detail}</s-text>
                {p.competitors.length > 0 && <s-text color="subdued">{p.competitors.join(", ")}</s-text>}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      {ideas.map((i, n) => (
        <s-section key={n} heading={i.angle || i.headline}>
          <s-stack gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge>{PLATFORM[i.platform] ?? i.platform}</s-badge>
              {i.productId ? (
                <s-link href={`shopify://admin/products/${i.productId.split("/").pop()}`} target="_blank">
                  {i.product}
                </s-link>
              ) : (
                <s-text>{i.product}</s-text>
              )}
            </s-stack>
            <s-text color="subdued">{i.why}</s-text>
            <Copyable label="Headline" text={i.headline} limit={40} />
            <Copyable label="Primary text" text={i.primaryText} />
            <Copyable label="Picture or video" text={i.visual} />
            <s-text color="subdued">Button: {i.cta}</s-text>
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
