import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { atOrigin, blogArticles, deleteArticle, sendArticle, storeOrigin } from "../lib/ideas/articles.server";
import { syncIfStale, type Graphql } from "../lib/prices/prices.server";
import { makeArticleImage } from "../lib/ideas/images.server";

// Blog articles written from keyword ideas, to read through and send to the
// shop's Shopify blog.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  await syncIfStale(session.shop, graphql).catch((err) => console.error("Product sync failed", session.shop, err));
  const [articles, origin] = await Promise.all([blogArticles(session.shop), storeOrigin(graphql)]);
  return { articles: articles.map((a) => ({ ...a, url: atOrigin(a.url, origin) })), imagesOn: Boolean(process.env.OPENAI_API_KEY) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");
  if (intent === "image") return { id, ...(await makeArticleImage(session.shop, id)), at: Date.now() };
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
  const { articles, imagesOn } = useLoaderData<typeof loader>();
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
        <ArticleCard key={a.id} a={a} imagesOn={imagesOn} />
      ))}
    </s-page>
  );
}

function ArticleCard({ a, imagesOn }: { a: Article; imagesOn: boolean }) {
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
          {a.url && a.status === "published" && (
            <s-link href={a.url} target="_blank">
              View on your store
            </s-link>
          )}
          {a.shopifyId && (
            <s-link href={`shopify://admin/articles/${a.shopifyId.split("/").pop()}`} target="_blank">
              Open in Shopify
            </s-link>
          )}
        </s-stack>
        {error && <s-banner tone="warning">{error}</s-banner>}
        <ArticlePicture a={a} imagesOn={imagesOn} />
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
      <style>{`.sw-picture { display: block; width: 100%; max-width: 640px; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 8px; } .sw-article { max-height: 420px; overflow: auto; font-size: 14px; line-height: 1.55; } .sw-article h2 { font-size: 17px; margin: 16px 0 6px; } .sw-article h3 { font-size: 15px; margin: 12px 0 4px; } .sw-article p, .sw-article ul, .sw-article ol { margin: 0 0 10px; }`}</style>
    </s-section>
  );
}

// The article's picture, which goes on the blog as the post's main image,
// with a button to make one (or another) before it's sent.
function ArticlePicture({ a, imagesOn }: { a: Article; imagesOn: boolean }) {
  const make = useFetcher<typeof action>();
  const made = make.data && "ok" in make.data && make.data.id === a.id;
  // A new address after each remake, so the browser shows the new picture.
  const version = make.data && "at" in make.data ? make.data.at : 0;
  const error = make.state === "idle" && make.data && "error" in make.data ? make.data.error : a.imageError;
  const busy = make.state !== "idle";
  return (
    <s-stack gap="small">
      {a.imageAlt || made ? (
        <img className="sw-picture" src={`/images/${a.id}.jpg?v=${version}`} alt={a.imageAlt ?? a.title} />
      ) : (
        a.picture && (
          <>
            <img className="sw-picture" src={a.picture.url} alt={a.picture.altText} />
            {!a.shopifyId && <s-text color="subdued">The photo of {a.picture.altText}, which the article links to, goes on the post.</s-text>}
          </>
        )
      )}
      {!a.shopifyId && imagesOn && (
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button loading={busy} onClick={() => make.submit({ intent: "image", id: a.id }, { method: "post" })}>
            {a.imageAlt || made ? "Make a different picture" : "Make a picture"}
          </s-button>
          {busy && <s-text color="subdued">Making a picture takes up to a minute.</s-text>}
          {error && !busy && <s-text tone="critical">{error}</s-text>}
        </s-stack>
      )}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
