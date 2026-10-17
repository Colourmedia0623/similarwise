import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { formatPrice } from "../lib/format";
import { describeGap, priceGap } from "../lib/prices/match";
import { productMatches, setMatch } from "../lib/prices/prices.server";

// One of the shop's products: which product it matches at each competitor,
// with the likeliest candidates to pick from, or a search for the right one.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const found = await productMatches(session.shop, params.id ?? "", q);
  if (!found) throw new Response("Not found", { status: 404 });
  return { q, ...found };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const productId = String(form.get("competitorProductId") ?? "");
  const ok = await setMatch(session.shop, params.id ?? "", String(form.get("competitorId") ?? ""), productId || null);
  return { ok };
};

export default function ProductPrices() {
  const { q, product, competitors } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState(q);

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app/prices">
        Price comparison
      </s-link>

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Your price: <s-text type="strong">{formatPrice(product.priceCents, product.currency)}</s-text>
          </s-paragraph>
          <Form method="get">
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-text-field
                name="q"
                label="Search competitors' products"
                placeholder="Gift box 20x20"
                value={search}
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
              <s-button type="submit">Search</s-button>
              {q && (
                <s-button variant="tertiary" href={`/app/prices/${product.id}`}>
                  Clear
                </s-button>
              )}
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      {competitors.length === 0 && (
        <s-section>
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        </s-section>
      )}

      {competitors.map((c) => (
        <s-section key={c.id} heading={c.name}>
          <s-stack gap="base">
            <s-paragraph>
              {c.match?.product ? (
                <>
                  Matched with{" "}
                  <s-link href={`${c.url}/products/${c.match.product.handle}`} target="_blank">
                    {c.match.product.title}
                  </s-link>{" "}
                  at {formatPrice(c.match.product.priceCents, c.currency)}
                  {c.match.confirmed ? "." : ", suggested by name."}
                </>
              ) : c.match?.none ? (
                "You said they don't sell this."
              ) : (
                "No match yet."
              )}
            </s-paragraph>

            {c.candidates.length === 0 ? (
              <s-paragraph>
                <s-text color="subdued">
                  {q ? "Nothing at this store has every word you searched for." : "Nothing at this store has a similar name. Try a search."}
                </s-text>
              </s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">{q ? "Search results" : "Likeliest matches"}</s-table-header>
                  <s-table-header format="numeric">Their price</s-table-header>
                  <s-table-header>Vs yours</s-table-header>
                  <s-table-header></s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {c.candidates.map((p) => {
                    const sameCurrency = !c.currency || c.currency === product.currency;
                    const gap = describeGap(sameCurrency ? priceGap(product.priceCents, p.priceCents) : null);
                    const current = c.match?.product?.id === p.id;
                    return (
                      <s-table-row key={p.id}>
                        <s-table-cell>
                          <s-link href={`${c.url}/products/${p.handle}`} target="_blank">
                            {p.title}
                          </s-link>
                        </s-table-cell>
                        <s-table-cell>{formatPrice(p.priceCents, c.currency)}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={gap.tone}>{gap.label}</s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          {current && c.match?.confirmed ? (
                            <s-badge tone="success">Matched</s-badge>
                          ) : (
                            <Choose competitorId={c.id} productId={p.id} label={current ? "Confirm" : "This one"} />
                          )}
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            )}

            {!c.match?.none && (
              <s-box>
                <Choose competitorId={c.id} productId="" label="They don't sell this" variant="tertiary" />
              </s-box>
            )}
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

function Choose({
  competitorId,
  productId,
  label,
  variant = "secondary",
}: {
  competitorId: string;
  productId: string;
  label: string;
  variant?: "secondary" | "tertiary";
}) {
  const fetcher = useFetcher<typeof action>();
  return (
    <s-button
      variant={variant}
      loading={fetcher.state !== "idle"}
      onClick={() => fetcher.submit({ competitorId, competitorProductId: productId }, { method: "post" })}
    >
      {label}
    </s-button>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
