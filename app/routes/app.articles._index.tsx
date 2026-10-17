import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { blogArticles } from "../lib/ideas/articles.server";
import { syncIfStale, type Graphql } from "../lib/prices/prices.server";
import { STATUS } from "../lib/ideas/article-status";

// Every blog article written for the shop, as tiles with their pictures. Each
// opens in the editor (app.articles.$id).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  await syncIfStale(session.shop, graphql).catch((err) => console.error("Product sync failed", session.shop, err));
  return { articles: await blogArticles(session.shop) };
};


export default function Articles() {
  const { articles } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Blog articles">
      <s-section>
        <s-paragraph>
          Articles written for your <s-link href="/app/ideas">keyword ideas</s-link> and your <s-link href="/app/calendar">content calendar</s-link>,
          linking to your own products. Open one to read it, change the words or the picture, and add it to your blog.
        </s-paragraph>
        {articles.length === 0 && (
          <s-paragraph>
            No articles yet. Open <s-link href="/app/ideas">Keyword ideas</s-link> and press Write blog article on an idea.
          </s-paragraph>
        )}
      </s-section>
      {articles.length > 0 && (
        <div className="sw-tiles">
          {articles.map((a) => {
            const status = a.status as keyof typeof STATUS;
            return (
              <Link key={a.id} to={`/app/articles/${a.id}`} className="sw-tile">
                {a.picture ? <img src={a.picture.url} alt="" /> : <div className="sw-noimg">No picture yet</div>}
                <div className="sw-tile-body">
                  <span className={`sw-status sw-${status}`}>{STATUS[status] ?? a.status}</span>
                  <strong>{a.title}</strong>
                  <span className="sw-muted">
                    “{a.keyword}”{a.searchVolume != null ? ` · ${compact(a.searchVolume)} searches a month` : ""}
                  </span>
                  <span className="sw-muted">Written {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <style>{CSS}</style>
    </s-page>
  );
}

const CSS = `
.sw-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.sw-tile { display: flex; flex-direction: column; background: #fff; border: 1px solid #e3e3e3; border-radius: 12px; overflow: hidden; color: inherit; text-decoration: none; transition: box-shadow .15s, transform .15s; }
.sw-tile:hover { box-shadow: 0 4px 14px rgba(0,0,0,.08); transform: translateY(-1px); }
.sw-tile img, .sw-noimg { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; background: #f1f1f1; }
.sw-noimg { display: flex; align-items: center; justify-content: center; color: #8a8a8a; font-size: 13px; }
.sw-tile-body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 14px; font-size: 13px; line-height: 1.4; }
.sw-tile-body strong { font-size: 14px; color: #303030; }
.sw-muted { color: #616161; }
.sw-status { align-self: flex-start; padding: 2px 8px; border-radius: 8px; font-size: 12px; background: #ebebeb; color: #4a4a4a; }
.sw-status.sw-draft { background: #e0f0ff; color: #00527c; }
.sw-status.sw-published { background: #cdfee1; color: #0c5132; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
