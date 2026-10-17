import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { blogArticles, deleteArticle, sendArticle } from "../lib/ideas/articles.server";
import type { Graphql } from "../lib/prices/prices.server";

// Blog articles written from keyword ideas, to read through and send to the
// shop's Shopify blog.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { articles: await blogArticles(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");
  if (intent === "delete") {
    await deleteArticle(session.shop, id);
    return { id, ok: true as const };
  }
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  try {
    return { id, ...(await sendArticle(session.shop, id, intent === "publish", graphql)) };
  } catch (err) {
    console.error("Couldn't send an article", session.shop, err);
    return { id, error: "Couldn't reach your blog just now. Try again in a minute." };
  }
};

const STATUS = { written: "Not on your blog yet", draft: "Hidden draft on your blog", published: "Published" } as const;
const TONE = { written: "neutral", draft: "info", published: "success" } as const;

type Article = ReturnType<typeof useLoaderData<typeof loader>>["articles"][number];

export default function Articles() {
  const { articles } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Blog articles">
      <s-section>
        <s-paragraph>
          Articles written for the searches in your <s-link href="/app/ideas">keyword ideas</s-link>, linking to your own products. Read each one
          through, then add it to your Shopify blog as a hidden draft to edit there, or publish it straight away.
        </s-paragraph>
        {articles.length === 0 && (
          <s-paragraph>
            No articles yet. Open <s-link href="/app/ideas">Keyword ideas</s-link> and press Write article on an idea.
          </s-paragraph>
        )}
      </s-section>
      {articles.map((a) => (
        <ArticleCard key={a.id} a={a} />
      ))}
    </s-page>
  );
}

function ArticleCard({ a }: { a: Article }) {
  const send = useFetcher<typeof action>();
  const busy = (intent: string) => send.state !== "idle" && send.formData?.get("intent") === intent;
  const error = send.data && "error" in send.data ? send.data.error : a.error;
  const status = a.status as keyof typeof STATUS;
  return (
    <s-section heading={a.title}>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone={TONE[status] ?? "neutral"}>{STATUS[status] ?? a.status}</s-badge>
          <s-text color="subdued">
            For “{a.keyword}”{a.searchVolume != null ? `, ${compact(a.searchVolume)} searches a month` : ""}
          </s-text>
          {a.url && (
            <s-link href={a.url} target="_blank">
              View on your store
            </s-link>
          )}
        </s-stack>
        {error && <s-banner tone="warning">{error}</s-banner>}
        <s-text color="subdued">
          Google shows: <strong>{a.metaTitle}</strong> · {a.metaDescription}
        </s-text>
        <s-box padding="base" border="base" borderRadius="base" background="subdued">
          <div className="sw-article" dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
        </s-box>
        {!a.shopifyId && (
          <s-stack direction="inline" gap="small">
            <s-button variant="primary" loading={busy("publish")} onClick={() => send.submit({ intent: "publish", id: a.id }, { method: "post" })}>
              Publish now
            </s-button>
            <s-button loading={busy("draft")} onClick={() => send.submit({ intent: "draft", id: a.id }, { method: "post" })}>
              Add as hidden draft
            </s-button>
            <s-button variant="tertiary" tone="critical" loading={busy("delete")} onClick={() => send.submit({ intent: "delete", id: a.id }, { method: "post" })}>
              Delete
            </s-button>
          </s-stack>
        )}
      </s-stack>
      <style>{`.sw-article { max-height: 420px; overflow: auto; font-size: 14px; line-height: 1.55; } .sw-article h2 { font-size: 17px; margin: 16px 0 6px; } .sw-article h3 { font-size: 15px; margin: 12px 0 4px; } .sw-article p, .sw-article ul, .sw-article ol { margin: 0 0 10px; }`}</style>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
