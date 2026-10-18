import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { atOrigin, blogArticle, deleteArticle, editArticle, sendArticle, storeOrigin, updateOnShopify } from "../lib/ideas/articles.server";
import { makeArticleImage, uploadArticleImage } from "../lib/ideas/images.server";
import type { Graphql } from "../lib/prices/prices.server";
import { STATUS, TONE } from "../lib/ideas/article-status";
import { articleShares, shareArticle, socialAccounts, tiktokAccount, writeCaptions } from "../lib/social/social.server";
import type { TikTokChoices } from "../lib/social/networks.server";
import { NETWORK_NAME, type Network } from "../lib/social/networks";

// One blog article: read and change its words, Google listing and picture,
// then add it to the blog. Changes to an article already on the blog are
// copied to the post when saved.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  const [article, origin, accounts, shares] = await Promise.all([
    blogArticle(session.shop, params.id ?? ""),
    storeOrigin(graphql),
    socialAccounts(session.shop),
    articleShares(session.shop, params.id ?? ""),
  ]);
  if (!article) throw redirect("/app/articles");
  return { article: { ...article, url: atOrigin(article.url, origin) }, imagesOn: Boolean(process.env.OPENAI_API_KEY), accounts, shares };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const id = params.id ?? "";
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const at = Date.now();

  if (intent === "captions") {
    try {
      const captions = await writeCaptions(shop, id);
      return "error" in captions ? { intent, at, error: captions.error } : { intent, at, captions };
    } catch (err) {
      console.error("Couldn't write captions", shop, err);
      return { intent, at, error: "Couldn't write the captions just now. Try again in a minute." };
    }
  }
  if (intent === "tiktok") return { intent, at, ...(await tiktokAccount(shop, String(form.get("accountId") ?? ""))) };
  if (intent === "share") {
    const picks = JSON.parse(String(form.get("picks") ?? "[]")) as { accountId: string; caption: string; tiktok?: TikTokChoices }[];
    return { intent, at, ...(await shareArticle(shop, id, picks, { origin: await storeOrigin(graphql) })) };
  }

  if (intent === "delete") {
    const gone = await deleteArticle(shop, id, graphql);
    if ("error" in gone) return { intent, at, error: gone.error };
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
              </>
            )}
            <s-button
              variant="tertiary"
              tone="critical"
              loading={busy("delete")}
              onClick={() => {
                if (!sent || confirm("Delete this article? It comes off your blog too.")) save.submit({ intent: "delete" }, { method: "post" });
              }}
            >
              Delete
            </s-button>
            {dirty && <s-text color="subdued">Unsaved changes</s-text>}
          </s-stack>
        </s-section>

        <Share published={a.status === "published"} picture={a.picture?.url ?? null} />
      </s-stack>
      <style>{CSS}</style>
    </s-page>
  );
}

// Sharing the article to the shop's connected social accounts, with a
// caption for each network.
function Share({ published, picture }: { published: boolean; picture: string | null }) {
  const { accounts, shares } = useLoaderData<typeof loader>();
  const [tiktok, setTiktok] = useState<Record<string, TikTokChoices | null>>({});
  const write = useFetcher<typeof action>();
  const post = useFetcher<typeof action>();
  const [captions, setCaptions] = useState<Record<Network, string>>({ facebook: "", instagram: "", tiktok: "" });
  const [picked, setPicked] = useState<string[]>(accounts.map((x) => x.id));
  const [seen, setSeen] = useState<number | null>(null);
  const written = write.state === "idle" && write.data && "captions" in write.data && write.data.captions ? { at: write.data.at, captions: write.data.captions } : null;
  // New captions from Claude replace what's in the boxes, once.
  if (written && written.at !== seen) {
    setSeen(written.at);
    setCaptions(written.captions);
  }
  const writeError = write.state === "idle" && write.data && "error" in write.data ? write.data.error : null;
  const result = post.state === "idle" ? post.data : undefined;
  const networks = [...new Set(accounts.filter((x) => picked.includes(x.id)).map((x) => x.network))];
  const tiktokPicked = accounts.filter((x) => x.network === "tiktok" && picked.includes(x.id));
  const tiktokReady = tiktokPicked.every((x) => tiktok[x.id]);

  return (
    <s-section heading="Share on social">
      <s-stack gap="base">
        {accounts.length === 0 ? (
          <s-paragraph>
            Connect your Facebook Page, Instagram or TikTok under <s-link href="/app/social">Social accounts</s-link> to share your articles there.
          </s-paragraph>
        ) : !published ? (
          <s-paragraph>Publish the article on your blog first, so the posts can link to it.</s-paragraph>
        ) : (
          <>
            <s-stack direction="inline" gap="base">
              {accounts.map((x) => (
                <s-checkbox
                  key={x.id}
                  label={`${NETWORK_NAME[x.network]}: ${x.name}`}
                  checked={picked.includes(x.id)}
                  onChange={(e) => setPicked(e.currentTarget.checked ? [...picked, x.id] : picked.filter((p) => p !== x.id))}
                />
              ))}
            </s-stack>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-button loading={write.state !== "idle"} onClick={() => write.submit({ intent: "captions" }, { method: "post" })}>
                {captions.facebook || captions.instagram || captions.tiktok ? "Write new captions" : "Write captions"}
              </s-button>
              {writeError && <s-text tone="critical">{writeError}</s-text>}
            </s-stack>
            {networks.map((n) => (
              <s-text-area
                key={n}
                label={`${NETWORK_NAME[n]} caption`}
                rows={n === "facebook" ? 3 : 5}
                value={captions[n]}
                details={n === "facebook" ? "The link to the article is added below it." : n === "tiktok" ? "Posted as a photo post with the article's picture." : "Posted with the article's picture."}
                onInput={(e) => setCaptions({ ...captions, [n]: e.currentTarget.value })}
              />
            ))}
            {tiktokPicked.map((x) => (
              <TikTokPost key={x.id} accountId={x.id} picture={picture} caption={captions.tiktok} onChange={(c) => setTiktok((t) => ({ ...t, [x.id]: c }))} />
            ))}
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-button
                variant="primary"
                loading={post.state !== "idle"}
                disabled={!picked.length || networks.some((n) => !captions[n].trim()) || !tiktokReady}
                onClick={() =>
                  post.submit(
                    {
                      intent: "share",
                      picks: JSON.stringify(
                        accounts
                          .filter((x) => picked.includes(x.id))
                          .map((x) => ({ accountId: x.id, caption: captions[x.network], ...(x.network === "tiktok" ? { tiktok: tiktok[x.id] } : {}) })),
                      ),
                    },
                    { method: "post" },
                  )
                }
              >
                Post now
              </s-button>
              {result && "error" in result && <s-text tone="critical">{result.error}</s-text>}
              {result && "posted" in result && (
                <s-text tone="success">
                  Posted to {result.posted === 1 ? "1 account" : `${result.posted} accounts`}
                  {result.failed ? `; ${result.failed} didn't go, see below.` : "."}
                  {tiktokPicked.length > 0 && " TikTok can take a few minutes to process the post before it shows on your profile."}
                </s-text>
              )}
            </s-stack>
          </>
        )}
        {shares.length > 0 && (
          <s-stack gap="small">
            <s-heading>Shared</s-heading>
            {shares.map((p) => (
              <s-stack key={p.id} direction="inline" gap="small" alignItems="center">
                <s-badge tone={p.status === "failed" ? "critical" : "success"}>{p.status === "failed" ? "Didn't go" : p.status === "processing" ? "Sent to TikTok" : "Posted"}</s-badge>
                <s-text>
                  {NETWORK_NAME[p.network]}: {p.account}, {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </s-text>
                {p.url && (
                  <s-link href={p.url} target="_blank">
                    Open the post
                  </s-link>
                )}
                {p.error && <s-text color="subdued">{p.error}</s-text>}
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

// What TikTok's rules ask for before each post: the account it goes to,
// who can see it (no default), comments off until turned on, whether it
// promotes a brand, a preview, and TikTok's own terms. Nothing here is
// chosen for the merchant.
const PRIVACY: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};
const MUSIC = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRANDED = "https://www.tiktok.com/legal/page/global/bc-policy/en";

function TikTokPost({ accountId, picture, caption, onChange }: { accountId: string; picture: string | null; caption: string; onChange: (c: TikTokChoices | null) => void }) {
  const info = useFetcher<typeof action>();
  const [privacy, setPrivacy] = useState("");
  const [allowComments, setAllowComments] = useState(false);
  const [disclose, setDisclose] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [brandedContent, setBrandedContent] = useState(false);
  useEffect(() => {
    info.submit({ intent: "tiktok", accountId }, { method: "post" });
    // Read once when the account is picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);
  const data = info.state === "idle" ? info.data : undefined;
  const creator = data && "creator" in data ? data.creator : null;
  const error = data && "error" in data ? data.error : null;
  const brandMissing = disclose && !yourBrand && !brandedContent;
  const privateBranded = brandedContent && privacy === "SELF_ONLY";
  const ready = !!creator && !!privacy && !brandMissing && !privateBranded;
  useEffect(() => {
    onChange(ready ? { privacy, allowComments: allowComments && !creator?.commentDisabled, yourBrand: disclose && yourBrand, brandedContent: disclose && brandedContent } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, privacy, allowComments, disclose, yourBrand, brandedContent]);

  if (error) return <s-banner tone="critical">{error}</s-banner>;
  if (!creator) return <s-text color="subdued">Checking your TikTok account…</s-text>;
  const label = brandedContent ? "Paid partnership" : yourBrand ? "Promotional content" : null;
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          {creator.avatar && <img className="sw-avatar" src={creator.avatar} alt="" />}
          <s-text type="strong">Posting to TikTok as {creator.nickname || creator.username}</s-text>
          {creator.username && <s-text color="subdued">@{creator.username}</s-text>}
        </s-stack>
        {picture && (
          <s-stack direction="inline" gap="base">
            <img className="sw-tiktok-preview" src={picture} alt="What the TikTok post will show" />
            <s-paragraph>{caption || "Write a caption above."}</s-paragraph>
          </s-stack>
        )}
        <s-select label="Who can see this post" value={privacy} onChange={(e) => setPrivacy(e.currentTarget.value)}>
          <s-option value="">Choose who can see it</s-option>
          {creator.privacyOptions.map((o) => (
            <s-option key={o} value={o} disabled={brandedContent && o === "SELF_ONLY"}>
              {PRIVACY[o] ?? o}
            </s-option>
          ))}
        </s-select>
        {privateBranded && <s-text tone="critical">Branded content can&apos;t be private. Choose who can see it.</s-text>}
        <s-checkbox
          label="Allow comments"
          checked={allowComments && !creator.commentDisabled}
          disabled={creator.commentDisabled}
          details={creator.commentDisabled ? "Comments are turned off in your TikTok settings." : undefined}
          onChange={(e) => setAllowComments(e.currentTarget.checked)}
        />
        <s-switch
          label="Disclose commercial content"
          checked={disclose}
          details="Turn on if this post promotes your shop, a product, or a brand that paid you."
          onChange={(e) => setDisclose(e.currentTarget.checked)}
        />
        {disclose && (
          <s-stack gap="small">
            <s-checkbox
              label="Your brand"
              details="You're promoting yourself or your own business."
              checked={yourBrand}
              onChange={(e) => setYourBrand(e.currentTarget.checked)}
            />
            <s-checkbox
              label="Branded content"
              details="You're promoting another brand or a third party."
              checked={brandedContent}
              onChange={(e) => setBrandedContent(e.currentTarget.checked)}
            />
            {brandMissing && <s-text tone="critical">Choose whether you&apos;re promoting your brand, another brand, or both.</s-text>}
            {label && <s-text color="subdued">Your photo will be labelled &quot;{label}&quot;.</s-text>}
          </s-stack>
        )}
        <s-text color="subdued">
          By posting, you agree to TikTok&apos;s{" "}
          {brandedContent && (
            <>
              <s-link href={BRANDED} target="_blank">
                Branded Content Policy
              </s-link>{" "}
              and{" "}
            </>
          )}
          <s-link href={MUSIC} target="_blank">
            Music Usage Confirmation
          </s-link>
          .
        </s-text>
      </s-stack>
    </s-box>
  );
}

const CSS = `
.sw-avatar { width: 32px; height: 32px; border-radius: 50%; }
.sw-tiktok-preview { width: 120px; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 8px; }
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
