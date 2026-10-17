import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { atOrigin, blogArticle, deleteArticle, editArticle, sendArticle, storeOrigin, updateOnShopify } from "../lib/ideas/articles.server";
import { makeArticleImage, uploadArticleImage } from "../lib/ideas/images.server";
import type { Graphql } from "../lib/prices/prices.server";
import { STATUS, TONE } from "../lib/ideas/article-status";

// One blog article: read and change its words, Google listing and picture,
// then add it to the blog. Changes to an article already on the blog are
// copied to the post when saved.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  const [article, origin] = await Promise.all([blogArticle(session.shop, params.id ?? ""), storeOrigin(graphql)]);
  if (!article) throw redirect("/app/articles");
  return { article: { ...article, url: atOrigin(article.url, origin) }, imagesOn: Boolean(process.env.OPENAI_API_KEY) };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id ?? "";
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const at = Date.now();

  if (intent === "delete") {
    await deleteArticle(shop, id);
    return redirect("/app/articles");
  }
  if (intent === "image" || intent === "upload") {
    const file = form.get("file");
    const res =
      intent === "image"
        ? await makeArticleImage(shop, id)
        : file instanceof File
          ? await uploadArticleImage(shop, id, file)
          : { error: "Choose a picture to upload." };
    // A new picture goes straight onto a post that's already on the blog.
    if ("ok" in res) {
      const synced = await updateOnShopify(shop, id, graphql);
      if ("error" in synced) return { intent, at, error: synced.error };
    }
    return { intent, at, ...res };
  }

  const text = (k: string) => String(form.get(k) ?? "");
  const saved = await editArticle(
    shop,
    id,
    {
      title: text("title"),
      summary: text("summary"),
      bodyHtml: text("bodyHtml"),
      metaTitle: text("metaTitle"),
      metaDescription: text("metaDescription"),
      tags: text("tags").split(","),
    },
    graphql,
  );
  if ("error" in saved || intent === "save") return { intent, at, ...saved };
  try {
    return { intent, at, ...(await sendArticle(shop, id, intent === "publish", graphql)) };
  } catch (err) {
    console.error("Couldn't send an article", shop, err);
    return { intent, at, error: "Couldn't reach your blog just now. Try again in a minute." };
  }
};

const TOOLS: { label: string; title: string; run: () => void }[] = [
  { label: "H2", title: "Heading", run: () => document.execCommand("formatBlock", false, "h2") },
  { label: "H3", title: "Subheading", run: () => document.execCommand("formatBlock", false, "h3") },
  { label: "¶", title: "Paragraph", run: () => document.execCommand("formatBlock", false, "p") },
  { label: "B", title: "Bold", run: () => document.execCommand("bold") },
  { label: "I", title: "Italic", run: () => document.execCommand("italic") },
  { label: "• List", title: "Bulleted list", run: () => document.execCommand("insertUnorderedList") },
  { label: "1. List", title: "Numbered list", run: () => document.execCommand("insertOrderedList") },
  {
    label: "Link",
    title: "Link the selected words",
    run: () => {
      const url = window.prompt("Link to (for example /products/gift-box or https://…)");
      if (url) document.execCommand("createLink", false, url);
    },
  },
  { label: "Unlink", title: "Remove link", run: () => document.execCommand("unlink") },
];

export default function ArticleEditor() {
  const { article: a, imagesOn } = useLoaderData<typeof loader>();
  const save = useFetcher<typeof action>();
  const picture = useFetcher<typeof action>();
  const body = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState({
    title: a.title,
    summary: a.summary,
    metaTitle: a.metaTitle,
    metaDescription: a.metaDescription,
    tags: a.tags.join(", "),
  });
  const [dirty, setDirty] = useState(false);
  const set = (k: keyof typeof fields) => (e: Event) => {
    setFields({ ...fields, [k]: (e.currentTarget as HTMLInputElement).value });
    setDirty(true);
  };
  const status = a.status as keyof typeof STATUS;
  const sent = Boolean(a.shopifyId);
  const busy = (intent: string) => save.state !== "idle" && save.formData?.get("intent") === intent;
  const submit = (intent: string) => {
    save.submit({ intent, ...fields, bodyHtml: body.current?.innerHTML ?? a.bodyHtml }, { method: "post" });
    setDirty(false);
  };
  const result = save.state === "idle" ? save.data : undefined;
  const picResult = picture.state === "idle" ? picture.data : undefined;
  const picBusy = picture.state !== "idle";

  return (
    <s-page heading={a.title}>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <Link to="/app/articles">← All articles</Link>
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

        {result && "error" in result && <s-banner tone="warning">{result.error}</s-banner>}
        {result && "ok" in result && (
          <s-banner tone="success">
            {result.intent === "publish" ? "Published on your blog." : result.intent === "draft" ? "Added to your blog as a hidden draft." : sent ? "Saved, and your blog post is updated." : "Saved."}
          </s-banner>
        )}
        {!result && a.error && <s-banner tone="warning">{a.error}</s-banner>}

        <s-section heading="Picture">
          <s-stack gap="small">
            {a.picture ? (
              <img className="sw-picture" src={a.picture.url} alt={a.picture.altText} />
            ) : (
              <s-text color="subdued">No picture yet.</s-text>
            )}
            {a.picture && !a.picture.made && <s-text color="subdued">The photo of {a.picture.altText}, which the article links to, is used until you make or upload one.</s-text>}
            <s-stack direction="inline" gap="small" alignItems="center">
              {imagesOn && (
                <s-button loading={picBusy && picture.formData?.get("intent") === "image"} disabled={picBusy} onClick={() => picture.submit({ intent: "image" }, { method: "post" })}>
                  {a.picture?.made ? "Make a different picture" : "Make a picture"}
                </s-button>
              )}
              <s-button loading={picBusy && picture.formData?.get("intent") === "upload"} disabled={picBusy} onClick={() => file.current?.click()}>
                Upload your own
              </s-button>
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (!f) return;
                  const data = new FormData();
                  data.append("intent", "upload");
                  data.append("file", f);
                  picture.submit(data, { method: "post", encType: "multipart/form-data" });
                  e.currentTarget.value = "";
                }}
              />
              {picBusy && picture.formData?.get("intent") === "image" && <s-text color="subdued">Making a picture takes up to a minute.</s-text>}
              {picResult && "error" in picResult && <s-text tone="critical">{picResult.error}</s-text>}
              {(a.imageError && !picResult) && <s-text tone="critical">{a.imageError}</s-text>}
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="Article">
          <s-stack gap="base">
            <s-text-field label="Title" value={fields.title} onInput={set("title")} />
            <s-text-area label="Summary for the blog listing" value={fields.summary} rows={2} onInput={set("summary")} />
            <div>
              <div className="sw-toolbar">
                {TOOLS.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    title={t.title}
                    onMouseDown={(e) => {
                      // Keep the selection in the article while the button is pressed.
                      e.preventDefault();
                      t.run();
                      setDirty(true);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div
                ref={body}
                className="sw-article sw-editable"
                contentEditable
                suppressContentEditableWarning
                onInput={() => setDirty(true)}
                dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
              />
            </div>
          </s-stack>
        </s-section>

        <s-section heading="How Google shows it">
          <s-stack gap="base">
            <div className="sw-serp">
              <div className="sw-serp-url">{a.url ?? "Your store › blog"}</div>
              <div className="sw-serp-title">{fields.metaTitle || fields.title}</div>
              <div className="sw-serp-desc">{fields.metaDescription}</div>
            </div>
            <s-text-field label="Page title" details={`${fields.metaTitle.length} of about 60 characters`} value={fields.metaTitle} onInput={set("metaTitle")} />
            <s-text-area label="Description" details={`${fields.metaDescription.length} of about 155 characters`} value={fields.metaDescription} rows={2} onInput={set("metaDescription")} />
            <s-text-field label="Tags" details="Separate them with commas." value={fields.tags} onInput={set("tags")} />
          </s-stack>
        </s-section>

        <s-section>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button variant={sent ? "primary" : "secondary"} loading={busy("save")} onClick={() => submit("save")}>
              {sent ? "Save and update blog post" : "Save"}
            </s-button>
            {!sent && (
              <>
                <s-button variant="primary" loading={busy("publish")} onClick={() => submit("publish")}>
                  Publish now
                </s-button>
                <s-button loading={busy("draft")} onClick={() => submit("draft")}>
                  Add as hidden draft
                </s-button>
                <s-button variant="tertiary" tone="critical" loading={busy("delete")} onClick={() => save.submit({ intent: "delete" }, { method: "post" })}>
                  Delete
                </s-button>
              </>
            )}
            {dirty && <s-text color="subdued">Unsaved changes</s-text>}
          </s-stack>
        </s-section>
      </s-stack>
      <style>{CSS}</style>
    </s-page>
  );
}

const CSS = `
.sw-picture { display: block; width: 100%; max-width: 720px; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 10px; }
.sw-toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px; border: 1px solid #d4d4d4; border-bottom: 0; border-radius: 8px 8px 0 0; background: #f7f7f7; }
.sw-toolbar button { font: inherit; font-size: 13px; padding: 4px 10px; border: 1px solid #d4d4d4; border-radius: 6px; background: #fff; cursor: pointer; }
.sw-toolbar button:hover { background: #f0f0f0; }
.sw-article { font-size: 15px; line-height: 1.6; }
.sw-editable { min-height: 360px; padding: 14px 16px; border: 1px solid #d4d4d4; border-radius: 0 0 8px 8px; outline: none; background: #fff; }
.sw-editable:focus { border-color: #2a78d6; box-shadow: 0 0 0 1px #2a78d6; }
.sw-article h2 { font-size: 19px; margin: 18px 0 6px; } .sw-article h3 { font-size: 16px; margin: 14px 0 4px; }
.sw-article p, .sw-article ul, .sw-article ol { margin: 0 0 10px; } .sw-article a { color: #2a78d6; }
.sw-serp { max-width: 600px; font-family: arial, sans-serif; }
.sw-serp-url { font-size: 13px; color: #4d5156; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-serp-title { font-size: 19px; color: #1a0dab; margin: 2px 0; }
.sw-serp-desc { font-size: 14px; color: #4d5156; line-height: 1.45; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
