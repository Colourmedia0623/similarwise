import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import type { Graphql } from "../lib/prices/prices.server";
import { syncShopProducts } from "../lib/prices/prices.server";
import { isWebShop } from "../lib/web/shop";
import { applySeo, savedSuggestions, seoProducts, suggestSeo } from "../lib/seo/products.server";
import { LIMITS, type SeoProduct, type Suggestion } from "../lib/seo/products";

// Product SEO: each product's title, SEO title and meta description, better
// ones from Claude to change as you like, and Apply to put them on the store.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 80) || null;
  try {
    const page = await seoProducts(session.shop, isWebShop(session.shop) ? null : graphql, { after: url.searchParams.get("after"), q });
    return { ...page, q, error: null, web: isWebShop(session.shop), suggestions: await savedSuggestions(session.shop, page.products.map((p) => p.id)), claude: Boolean(process.env.ANTHROPIC_API_KEY) };
  } catch (err) {
    console.error("Couldn't list products for SEO", session.shop, err);
    return { products: [] as SeoProduct[], next: null, canApply: false, q, error: "Couldn't read your products just now. Try again in a minute.", web: isWebShop(session.shop), suggestions: {} as Record<string, Suggestion>, claude: false };
  }
};

type Values = { title: string; seoTitle: string; seoDescription: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const shop = session.shop;
  if (intent === "suggest") {
    const products = JSON.parse(String(form.get("products") ?? "[]")) as SeoProduct[];
    return { intent, ...(await suggestSeo(shop, products.slice(0, 25))) };
  }
  if (intent === "apply") {
    const items = JSON.parse(String(form.get("items") ?? "[]")) as ({ id: string } & Values)[];
    const failed: string[] = [];
    let applied = 0;
    for (const it of items.slice(0, 50)) {
      const res = await applySeo(shop, graphql, it.id, it);
      if ("error" in res) failed.push(res.error ?? "Couldn't apply.");
      else applied++;
    }
    return failed.length ? { intent, error: failed[0], applied } : { intent, ok: true as const, applied };
  }
  if (intent === "sync") {
    try {
      const n = await syncShopProducts(shop, graphql);
      return { intent, ok: true as const, synced: n };
    } catch (err) {
      return { intent, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { intent, error: "Unknown action." };
};

const count = (s: string | null | undefined) => (s ?? "").length;

export default function ProductSeo() {
  const { products, next, canApply, q, error, web, suggestions, claude } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const bulk = useFetcher<typeof action>();
  const sync = useFetcher<typeof action>();
  // What's in each product's boxes, changed or as suggested.
  const [edits, setEdits] = useState<Record<string, Values>>({});
  const valuesFor = (id: string): Values | null => {
    const s = suggestions[id];
    return edits[id] ?? (s ? { title: s.title, seoTitle: s.seoTitle, seoDescription: s.seoDescription } : null);
  };
  const waiting = products.filter((p) => suggestions[p.id] && !suggestions[p.id].appliedAt);
  const busy = bulk.state !== "idle";
  const result = bulk.state === "idle" ? bulk.data : undefined;

  return (
    <s-page heading="Product SEO">
      <style>{CSS}</style>
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Each product&apos;s title, the SEO title Google shows, and its meta description. Press Suggest for better ones, change anything you like, then{" "}
            {canApply ? "press Apply to put them on your store." : "copy them into your store."}
          </s-paragraph>
          {web && <s-banner tone="info">Your store isn&apos;t connected through the SimilarWise Shopify app, so changes can&apos;t be applied for you. Use Copy and paste them into your store.</s-banner>}
          {!claude && <s-banner tone="warning">Suggestions need Claude, which isn&apos;t switched on for this app yet.</s-banner>}
          <s-stack direction="inline" gap="small" alignItems="end">
            <Form method="get" className="sw-seo-search">
              <input type="search" name="q" defaultValue={q ?? ""} placeholder="Find a product" aria-label="Find a product" />
              <s-button type="submit">Search</s-button>
            </Form>
            <s-button
              disabled={busy || !products.length || !claude}
              loading={busy && bulk.formData?.get("intent") === "suggest"}
              onClick={() => bulk.submit({ intent: "suggest", products: JSON.stringify(products.filter((p) => !suggestions[p.id])) }, { method: "post" })}
            >
              Suggest for products without one ({products.filter((p) => !suggestions[p.id]).length})
            </s-button>
            {canApply && (
              <s-button
                variant="primary"
                disabled={busy || !waiting.length}
                loading={busy && bulk.formData?.get("intent") === "apply"}
                onClick={() => {
                  if (!window.confirm(`Apply ${waiting.length} suggested ${waiting.length === 1 ? "change" : "changes"} to your store?`)) return;
                  bulk.submit({ intent: "apply", items: JSON.stringify(waiting.map((p) => ({ id: p.id, ...valuesFor(p.id)! }))) }, { method: "post" });
                }}
              >
                Apply all {waiting.length} on this page
              </s-button>
            )}
          </s-stack>
          {busy && bulk.formData?.get("intent") === "suggest" && <s-text color="subdued">Writing suggestions takes up to a minute.</s-text>}
          {result && "error" in result && result.error && <s-banner tone="critical">{result.error}</s-banner>}
          {result && "ok" in result && result.intent === "apply" && <s-banner tone="success">Applied {result.applied} to your store.</s-banner>}
          {error && <s-banner tone="critical">{error}</s-banner>}
        </s-stack>
      </s-section>

      {!products.length && !error && (
        <s-section>
          <s-stack gap="small">
            <s-paragraph>{q ? `No products match “${q}”.` : "No products yet."}</s-paragraph>
            {web && !q && (
              <sync.Form method="post">
                <input type="hidden" name="intent" value="sync" />
                <s-button type="submit" loading={sync.state !== "idle"}>
                  Read products from your website
                </s-button>
                {sync.data && "error" in sync.data && <s-text tone="critical">{sync.data.error}</s-text>}
              </sync.Form>
            )}
          </s-stack>
        </s-section>
      )}

      {products.map((p) => (
        <ProductRow
          key={p.id}
          product={p}
          suggestion={suggestions[p.id] ?? null}
          values={valuesFor(p.id)}
          onChange={(v) => setEdits({ ...edits, [p.id]: v })}
          canApply={canApply}
          claude={claude}
          busy={busy}
        />
      ))}

      {(next || params.get("after")) && (
        <s-stack direction="inline" gap="small">
          {params.get("after") && (
            <s-button href={`/app/product-seo${q ? `?q=${encodeURIComponent(q)}` : ""}`} variant="tertiary">
              First page
            </s-button>
          )}
          {next && <s-button href={`/app/product-seo?${new URLSearchParams({ ...(q ? { q } : {}), after: next })}`}>Next page</s-button>}
        </s-stack>
      )}
    </s-page>
  );
}

function ProductRow({
  product: p,
  suggestion,
  values,
  onChange,
  canApply,
  claude,
  busy,
}: {
  product: SeoProduct;
  suggestion: Suggestion | null;
  values: Values | null;
  onChange: (v: Values) => void;
  canApply: boolean;
  claude: boolean;
  busy: boolean;
}) {
  const one = useFetcher<typeof action>();
  const working = one.state !== "idle";
  const res = one.state === "idle" ? one.data : undefined;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };
  const changed = suggestion && values && (values.title !== suggestion.title || values.seoTitle !== suggestion.seoTitle || values.seoDescription !== suggestion.seoDescription);
  const field = (key: keyof Values, label: string, limit: number, rows = 1) => {
    const v = values?.[key] ?? "";
    const over = v.length > limit;
    return (
      <label className="sw-seo-field">
        <span>
          {label}
          <em className={over ? "sw-seo-over" : ""}>
            {v.length}/{limit}
          </em>
          {!canApply && (
            <button type="button" className="sw-seo-copy" onClick={() => copy(key, v)}>
              {copied === key ? "Copied" : "Copy"}
            </button>
          )}
        </span>
        {rows > 1 ? (
          <textarea rows={rows} value={v} onChange={(e) => values && onChange({ ...values, [key]: e.currentTarget.value })} />
        ) : (
          <input value={v} onChange={(e) => values && onChange({ ...values, [key]: e.currentTarget.value })} />
        )}
      </label>
    );
  };
  return (
    <s-section>
      <div className="sw-seo-row">
        <div className="sw-seo-product">
          {p.image ? <img src={p.image} alt="" /> : <span className="sw-seo-noimg" />}
          <div>
            <strong>{p.title}</strong>
            {p.url && (
              <a href={p.url} target="_blank" rel="noreferrer">
                View on store
              </a>
            )}
            {suggestion?.appliedAt && <s-badge tone="success">Applied</s-badge>}
          </div>
        </div>
        <div className="sw-seo-cols">
          <div className="sw-seo-now">
            <h4>Now</h4>
            <dl>
              <dt>Title</dt>
              <dd>{p.title}</dd>
              <dt>
                SEO title {!p.unread && <em>{count(p.seoTitle)}/{LIMITS.seoTitle}</em>}
              </dt>
              <dd>{p.unread ? <i>Read from the product&apos;s page when you press Suggest</i> : (p.seoTitle ?? <i>Not set, so Google uses the product title</i>)}</dd>
              <dt>
                Meta description {!p.unread && <em>{count(p.seoDescription)}/{LIMITS.seoDescription}</em>}
              </dt>
              <dd>{p.unread ? <i>Read from the product&apos;s page when you press Suggest</i> : (p.seoDescription ?? <i>Not set, so Google picks words from the page</i>)}</dd>
            </dl>
          </div>
          <div className="sw-seo-new">
            <h4>Suggested</h4>
            {suggestion && values ? (
              <>
                {field("title", "Title", LIMITS.title)}
                {field("seoTitle", "SEO title", LIMITS.seoTitle)}
                {field("seoDescription", "Meta description", LIMITS.seoDescription, 3)}
                {suggestion.why && <p className="sw-seo-why">{suggestion.why}</p>}
                <s-stack direction="inline" gap="small" alignItems="center">
                  {canApply && (
                    <s-button
                      variant="primary"
                      disabled={busy || working}
                      loading={working && one.formData?.get("intent") === "apply"}
                      onClick={() => one.submit({ intent: "apply", items: JSON.stringify([{ id: p.id, ...values }]) }, { method: "post" })}
                    >
                      {suggestion.appliedAt && !changed ? "Apply again" : "Apply to store"}
                    </s-button>
                  )}
                  {changed && (
                    <s-button variant="tertiary" onClick={() => onChange({ title: suggestion.title, seoTitle: suggestion.seoTitle, seoDescription: suggestion.seoDescription })}>
                      Undo my changes
                    </s-button>
                  )}
                  <s-button
                    variant="tertiary"
                    disabled={busy || working || !claude}
                    loading={working && one.formData?.get("intent") === "suggest"}
                    onClick={() => one.submit({ intent: "suggest", products: JSON.stringify([p]) }, { method: "post" })}
                  >
                    Suggest again
                  </s-button>
                </s-stack>
              </>
            ) : (
              <s-stack gap="small">
                <s-text color="subdued">No suggestion yet.</s-text>
                <s-stack direction="inline">
                  <s-button
                    disabled={busy || working || !claude}
                    loading={working}
                    onClick={() => one.submit({ intent: "suggest", products: JSON.stringify([p]) }, { method: "post" })}
                  >
                    Suggest
                  </s-button>
                </s-stack>
              </s-stack>
            )}
            {res && "error" in res && res.error && <s-text tone="critical">{res.error}</s-text>}
            {res && "ok" in res && res.intent === "apply" && <s-text tone="success">Applied to your store.</s-text>}
          </div>
        </div>
      </div>
    </s-section>
  );
}

const CSS = `
.sw-seo-search { display: flex; gap: 8px; align-items: center; }
.sw-seo-search input { font: inherit; font-size: 14px; padding: 7px 10px; border: 1px solid #d6d9e6; border-radius: 9px; min-width: 220px; }
.sw-seo-row { display: flex; flex-direction: column; gap: 14px; }
.sw-seo-product { display: flex; gap: 12px; align-items: center; }
.sw-seo-product img, .sw-seo-noimg { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; background: #f1f1f4; flex: none; }
.sw-seo-product div { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.sw-seo-product strong { font-size: 15px; width: 100%; }
.sw-seo-product a { font-size: 13px; color: var(--sw-accent, #6d5dfc); }
.sw-seo-cols { display: grid; grid-template-columns: 1fr 1.3fr; gap: 18px; }
@media (max-width: 800px) { .sw-seo-cols { grid-template-columns: 1fr; } }
.sw-seo-cols h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #8a91a5; }
.sw-seo-now { padding: 12px 14px; border-radius: 12px; background: #f7f8fb; }
.sw-seo-now dl { margin: 0; }
.sw-seo-now dt { font-size: 12px; font-weight: 600; color: #5b6478; margin-top: 8px; }
.sw-seo-now dt:first-child { margin-top: 0; }
.sw-seo-now dd { margin: 2px 0 0; font-size: 14px; color: #1a1f36; }
.sw-seo-now dd i { color: #8a91a5; }
.sw-seo-now em, .sw-seo-field em { font-style: normal; font-weight: 400; color: #8a91a5; margin-left: 6px; }
.sw-seo-new { display: flex; flex-direction: column; gap: 10px; }
.sw-seo-field { display: flex; flex-direction: column; gap: 4px; }
.sw-seo-field span { display: flex; align-items: center; font-size: 12px; font-weight: 600; color: #5b6478; }
.sw-seo-field em.sw-seo-over { color: #c4291c; font-weight: 600; }
.sw-seo-field input, .sw-seo-field textarea { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #d6d9e6; border-radius: 9px; width: 100%; box-sizing: border-box; resize: vertical; }
.sw-seo-field input:focus, .sw-seo-field textarea:focus { outline: none; border-color: var(--sw-accent, #6d5dfc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sw-accent, #6d5dfc) 18%, transparent); }
.sw-seo-copy { margin-left: auto; font: inherit; font-size: 12px; padding: 2px 8px; border: 1px solid #d6d9e6; border-radius: 6px; background: #fff; cursor: pointer; }
.sw-seo-why { margin: 0; font-size: 13px; color: #5b6478; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
