import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { ideasClient, keywordIdeas, refreshIdeas } from "../lib/ideas/ideas.server";
import { Copyable } from "../components/Copyable";
import { syncIfStale, type Graphql } from "../lib/prices/prices.server";
import { writeArticle } from "../lib/ideas/articles.server";

// Keyword ideas: which page to point at each search competitors win, with
// the words to put on it.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: ideasClient() != null, ...(await keywordIdeas(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "article") {
    const idea = String(form.get("idea") ?? "");
    try {
      return { idea, ...(await writeArticle(session.shop, idea)) };
    } catch (err) {
      console.error("Couldn't write an article", session.shop, err);
      return { idea, error: "Couldn't write that article just now. Try again in a minute." };
    }
  }
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  await syncIfStale(session.shop, graphql).catch((err) => console.error("Product sync failed", session.shop, err));
  try {
    return await refreshIdeas(session.shop);
  } catch (err) {
    console.error("Couldn't write keyword ideas", session.shop, err);
    return { error: "Couldn't write ideas just now. Try again in a minute." };
  }
};

const KIND = { product: "Product page", collection: "New collection", blog: "Blog post" } as const;

export default function Ideas() {
  const { on, ideas, createdAt } = useLoaderData<typeof loader>();
  const write = useFetcher<typeof action>();
  const busy = write.state !== "idle";
  const error = write.data && "error" in write.data && !("idea" in write.data) ? write.data.error : null;
  return (
    <s-page heading="Keyword ideas">
      {on && (
        <s-button slot="primary-action" loading={busy} onClick={() => write.submit({}, { method: "post" })}>
          {ideas.length ? "Write new ideas" : "Write ideas"}
        </s-button>
      )}
      {!on && <s-banner tone="info">Keyword ideas aren&apos;t switched on for this app yet.</s-banner>}
      {error && <s-banner tone="warning">{error}</s-banner>}

      <s-section>
        <s-paragraph>
          The searches your competitors win and you don&apos;t, with the page to point at each one and the words to put on it. They come from
          your <s-link href="/app/keywords">keyword gap</s-link> and your products. Writing them takes about a minute.
        </s-paragraph>
        {createdAt && <s-text color="subdued">Written {new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.</s-text>}
      </s-section>

      {ideas.length === 0 && on && !busy && (
        <s-section>
          <s-paragraph>No ideas yet. Press Write ideas to get some.</s-paragraph>
        </s-section>
      )}

      {ideas.map((i) => (
        <s-section key={i.id} heading={i.keyword}>
          <s-stack gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge>{KIND[i.pageKind as keyof typeof KIND] ?? i.pageKind}</s-badge>
              {i.productId ? (
                <s-link href={`shopify://admin/products/${i.productId.split("/").pop()}`} target="_blank">
                  {i.pageName}
                </s-link>
              ) : (
                <s-text>{i.pageName}</s-text>
              )}
              {i.searchVolume != null && <s-text color="subdued">{compact(i.searchVolume)} searches a month</s-text>}
            </s-stack>
            <s-text color="subdued">{i.why}</s-text>
            <Copyable label="Page title" text={i.seoTitle} limit={60} />
            <Copyable label="Meta description" text={i.metaDescription} limit={155} />
            <Copyable label="Opening paragraph" text={i.intro} />
            <ArticleButton idea={i.id} />
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

// Writes a full blog article for the idea, which then waits on the Blog
// articles page to be sent to the shop's blog.
function ArticleButton({ idea }: { idea: string }) {
  const write = useFetcher<typeof action>();
  const data = write.data && "idea" in write.data && write.data.idea === idea ? write.data : null;
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-button loading={write.state !== "idle"} onClick={() => write.submit({ intent: "article", idea }, { method: "post" })}>
        {data && "id" in data ? "Write another article" : "Write blog article"}
      </s-button>
      {write.state !== "idle" && <s-text color="subdued">Writing takes about a minute.</s-text>}
      {data && "id" in data && <Link to="/app/articles">Article written. Read it and add it to your blog</Link>}
      {data && "error" in data && <s-text tone="critical">{data.error}</s-text>}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
