import { useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import type { Graphql } from "../lib/prices/prices.server";
import { isWebShop } from "../lib/web/shop";
import {
  createListing,
  draftListing,
  findCategories,
  savePhotos,
} from "../lib/seo/listing.server";
import {
  COMPLIANCE_FIELDS,
  descriptionHtml,
  MAX_PHOTOS,
  missingCompliance,
  type Category,
  type Listing,
} from "../lib/seo/listing";
import { LIMITS } from "../lib/seo/products";

// Product from photos: upload a few photos of a product, its label and its
// packaging, and Claude writes the whole listing (title, description,
// category, details, SEO and EU safety information) to check and create.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return {
    web: isWebShop(session.shop),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const web = isWebShop(shop);
  const graphql: Graphql | null = web
    ? null
    : async (query, variables) =>
        (await admin.graphql(query, { variables })).json();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "draft") {
    const files = form
      .getAll("photos")
      .filter((f): f is File => typeof f !== "string");
    const saved = await savePhotos(shop, files);
    if ("error" in saved) return { intent, error: saved.error };
    const res = await draftListing(
      shop,
      saved.ids,
      String(form.get("notes") ?? ""),
      { graphql },
    );
    if ("error" in res) return { intent, error: res.error };
    return { intent, ok: true as const, ...res, imageIds: saved.ids };
  }
  if (intent === "redraft") {
    const ids = JSON.parse(String(form.get("imageIds") ?? "[]")) as string[];
    const res = await draftListing(shop, ids, String(form.get("notes") ?? ""), {
      graphql,
    });
    if ("error" in res) return { intent, error: res.error };
    return { intent, ok: true as const, ...res, imageIds: ids };
  }
  if (intent === "categories") {
    if (!graphql) return { intent, categories: [] as Category[] };
    return {
      intent,
      categories: await findCategories(graphql, String(form.get("q") ?? "")),
    };
  }
  if (intent === "create") {
    if (!graphql)
      return {
        intent,
        error:
          "Your store isn't connected through the SimilarWise Shopify app, so products can't be created for you.",
      };
    const listing = JSON.parse(String(form.get("listing") ?? "{}")) as Listing;
    const ids = JSON.parse(String(form.get("imageIds") ?? "[]")) as string[];
    return { intent, ...(await createListing(shop, graphql, listing, ids)) };
  }
  return { intent, error: "Unknown action." };
};

type Draft = { listing: Listing; categories: Category[]; imageIds: string[] };
const isDraft = (d: unknown): d is Draft =>
  Boolean(d && typeof d === "object" && "listing" in d && "imageIds" in d);

export default function ProductPhotos() {
  const { web, claude } = useLoaderData<typeof loader>();
  const write = useFetcher<typeof action>();
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [handled, setHandled] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  // A new listing from Claude replaces the photo picker.
  const written = write.state === "idle" ? write.data : undefined;
  if (written && written !== handled) {
    setHandled(written);
    if (isDraft(written))
      setDraft({
        listing: written.listing,
        categories: written.categories,
        imageIds: written.imageIds,
      });
  }

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const added = Array.from(list)
      .filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type))
      .slice(0, MAX_PHOTOS - files.length)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setFiles([...files, ...added]);
    if (input.current) input.current.value = "";
  };
  const clearFiles = () => {
    files.forEach((f) => URL.revokeObjectURL(f.url));
    setFiles([]);
  };
  const writing = write.state !== "idle";
  const error =
    write.state === "idle" && write.data && "error" in write.data
      ? write.data.error
      : null;

  const submit = () => {
    const fd = new FormData();
    fd.set("intent", "draft");
    fd.set("notes", notes);
    files.forEach((f) => fd.append("photos", f.file));
    write.submit(fd, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <s-page heading="Product from photos">
      <style>{CSS}</style>
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Take a few photos of the product, its label and its packaging.
            Claude reads them and writes the whole listing: title, description,
            category, product details, SEO and EU safety information. You check
            it, change anything you like, then{" "}
            {web
              ? "copy it into your store."
              : "create it in Shopify as a draft."}
          </s-paragraph>
          {!claude && (
            <s-banner tone="warning">
              Writing listings needs Claude, which isn&apos;t switched on for
              this app yet.
            </s-banner>
          )}
          {web && (
            <s-banner tone="info">
              Your store isn&apos;t connected through the SimilarWise Shopify
              app, so you&apos;ll copy the listing into your store yourself.
            </s-banner>
          )}

          {!draft && (
            <>
              <div
                className="sw-pp-drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addFiles(e.dataTransfer.files);
                }}
              >
                {files.map((f, i) => (
                  <div key={f.url} className="sw-pp-thumb">
                    <img src={f.url} alt={`Upload ${i + 1}`} />
                    <button
                      type="button"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => {
                        URL.revokeObjectURL(f.url);
                        setFiles(files.filter((_, j) => j !== i));
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {files.length < MAX_PHOTOS && (
                  <label className="sw-pp-add">
                    <input
                      ref={input}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(e) => addFiles(e.currentTarget.files)}
                    />
                    <strong>+ Add photos</strong>
                    <span>
                      Up to {MAX_PHOTOS}: the product, its label, the back of
                      the pack
                    </span>
                  </label>
                )}
              </div>
              <label className="sw-pp-field">
                <span>Notes (optional)</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.currentTarget.value)}
                  placeholder="Anything the photos don't show, such as sizes it comes in, materials or who makes it"
                />
              </label>
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-button
                  variant="primary"
                  disabled={!files.length || !claude || writing}
                  loading={writing}
                  onClick={submit}
                >
                  Write the listing
                </s-button>
                {writing && (
                  <s-text color="subdued">
                    Reading your photos and writing the listing takes up to a
                    minute.
                  </s-text>
                )}
              </s-stack>
            </>
          )}
          {error && <s-banner tone="critical">{error}</s-banner>}
        </s-stack>
      </s-section>

      {draft && (
        <Review
          key={draft.imageIds.join()}
          draft={draft}
          web={web}
          notes={notes}
          onStartAgain={() => {
            setDraft(null);
            clearFiles();
            setNotes("");
          }}
        />
      )}
    </s-page>
  );
}

function Review({
  draft,
  web,
  notes,
  onStartAgain,
}: {
  draft: Draft;
  web: boolean;
  notes: string;
  onStartAgain: () => void;
}) {
  const [l, setL] = useState<Listing>(draft.listing);
  const [categories, setCategories] = useState<Category[]>(draft.categories);
  const [catQuery, setCatQuery] = useState("");
  const create = useFetcher<typeof action>();
  const redo = useFetcher<typeof action>();
  const cats = useFetcher<typeof action>();
  const [copied, setCopied] = useState(false);
  const [handled, setHandled] = useState<unknown[]>([]);
  const set = <K extends keyof Listing>(k: K, v: Listing[K]) =>
    setL({ ...l, [k]: v });

  // New category matches, and a listing written again, as they come back.
  const found = cats.state === "idle" ? cats.data : undefined;
  if (found && !handled.includes(found)) {
    setHandled([...handled, found]);
    if ("categories" in found && found.categories)
      setCategories(found.categories);
  }
  const rewritten = redo.state === "idle" ? redo.data : undefined;
  if (rewritten && !handled.includes(rewritten)) {
    setHandled([...handled, rewritten]);
    if (isDraft(rewritten)) {
      setL(rewritten.listing);
      setCategories(rewritten.categories);
    }
  }

  const made = create.state === "idle" ? create.data : undefined;
  const done = made && "numericId" in made && made.numericId ? made : null;
  const createError =
    create.state === "idle" && create.data && "error" in create.data
      ? create.data.error
      : null;
  const redoError =
    redo.state === "idle" && redo.data && "error" in redo.data
      ? redo.data.error
      : null;
  const missing = missingCompliance(l.compliance);
  const category = categories.find((c) => c.id === l.categoryId);

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    {
      limit,
      rows = 1,
      hint,
    }: { limit?: number; rows?: number; hint?: string } = {},
  ) => (
    <label className="sw-pp-field">
      <span>
        {label}
        {limit && (
          <em className={value.length > limit ? "sw-pp-over" : ""}>
            {value.length}/{limit}
          </em>
        )}
      </span>
      {rows > 1 ? (
        <textarea
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );

  return (
    <>
      <s-section heading="Photos">
        <div className="sw-pp-strip">
          {draft.imageIds.map((id, i) => (
            <img
              key={id}
              src={`/social-images/${id}.jpg`}
              alt={`Upload ${i + 1}`}
            />
          ))}
        </div>
      </s-section>

      {l.check.length > 0 && (
        <s-banner tone="warning" heading="Check before you publish">
          <ul className="sw-pp-check">
            {l.check.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </s-banner>
      )}

      <s-section heading="Listing">
        <div className="sw-pp-grid">
          {field("Title", l.title, (v) => set("title", v), {
            limit: LIMITS.title,
          })}
          {field("Description", l.description, (v) => set("description", v), {
            rows: 8,
            hint: "Leave a blank line between paragraphs.",
          })}
          <div className="sw-pp-row">
            {field("Product type", l.productType, (v) => set("productType", v))}
            {field("Brand", l.vendor, (v) => set("vendor", v))}
            {!web &&
              field("Price", l.price, (v) => set("price", v), {
                hint: "Optional. You can add it in Shopify later.",
              })}
          </div>
          {field(
            "Tags",
            l.tags.join(", "),
            (v) =>
              set(
                "tags",
                v
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            { hint: "Separate tags with commas." },
          )}
          <div className="sw-pp-field">
            <span>Category</span>
            {web ? (
              <input
                value={l.categoryPath}
                onChange={(e) => set("categoryPath", e.currentTarget.value)}
              />
            ) : (
              <>
                <select
                  value={l.categoryId ?? ""}
                  onChange={(e) =>
                    set("categoryId", e.currentTarget.value || null)
                  }
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
                <div className="sw-pp-catsearch">
                  <input
                    value={catQuery}
                    onChange={(e) => setCatQuery(e.currentTarget.value)}
                    placeholder="Search Shopify's categories"
                    aria-label="Search Shopify's categories"
                  />
                  <s-button
                    disabled={!catQuery.trim()}
                    loading={cats.state !== "idle"}
                    onClick={() =>
                      cats.submit(
                        { intent: "categories", q: catQuery },
                        { method: "post" },
                      )
                    }
                  >
                    Search
                  </s-button>
                </div>
                <small>
                  {category
                    ? `Suggested from: ${l.categoryPath}`
                    : l.categoryPath
                      ? `Claude suggested “${l.categoryPath}”. Pick the closest match.`
                      : ""}
                </small>
              </>
            )}
          </div>
        </div>
      </s-section>

      <s-section heading="Product details">
        <div className="sw-pp-attrs">
          {l.attributes.map((a, i) => (
            <div key={i} className="sw-pp-attr">
              <input
                value={a.name}
                aria-label="Detail"
                placeholder="Such as Material"
                onChange={(e) =>
                  set(
                    "attributes",
                    l.attributes.map((x, j) =>
                      j === i ? { ...x, name: e.currentTarget.value } : x,
                    ),
                  )
                }
              />
              <input
                value={a.value}
                aria-label="Value"
                placeholder="Such as Soy wax"
                onChange={(e) =>
                  set(
                    "attributes",
                    l.attributes.map((x, j) =>
                      j === i ? { ...x, value: e.currentTarget.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label="Remove"
                onClick={() =>
                  set(
                    "attributes",
                    l.attributes.filter((_, j) => j !== i),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          <s-stack direction="inline">
            <s-button
              variant="tertiary"
              onClick={() =>
                set("attributes", [...l.attributes, { name: "", value: "" }])
              }
            >
              Add a detail
            </s-button>
          </s-stack>
        </div>
      </s-section>

      <s-section heading="Search engines">
        <div className="sw-pp-grid">
          {field("SEO title", l.seoTitle, (v) => set("seoTitle", v), {
            limit: LIMITS.seoTitle,
          })}
          {field(
            "Meta description",
            l.seoDescription,
            (v) => set("seoDescription", v),
            { limit: LIMITS.seoDescription, rows: 3 },
          )}
        </div>
      </s-section>

      <s-section heading="EU safety information">
        <s-stack gap="base">
          <s-paragraph>
            Products sold to EU shoppers need the maker&apos;s name and contact
            details, any safety warnings and, for makers outside the EU, an EU
            responsible person. These show under the description and are saved
            with the product.
          </s-paragraph>
          {missing.length > 0 && (
            <s-banner tone="warning">
              Not filled in yet: {missing.join(", ")}.
            </s-banner>
          )}
          <div className="sw-pp-comp">
            {COMPLIANCE_FIELDS.map(([k, label, hint]) =>
              field(
                label,
                l.compliance[k],
                (v) => set("compliance", { ...l.compliance, [k]: v }),
                {
                  rows: k === "warnings" || k === "manufacturerAddress" ? 2 : 1,
                  hint: hint || undefined,
                },
              ),
            )}
          </div>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack gap="small">
          {done ? (
            <s-banner tone="success" heading="Created in Shopify as a draft">
              <s-stack gap="small">
                <s-paragraph>
                  Check it over in Shopify, then set it to Active to put it on
                  sale.{done.warning ? ` ${done.warning}` : ""}
                </s-paragraph>
                <s-stack direction="inline" gap="small">
                  <s-button
                    href={`shopify://admin/products/${done.numericId}`}
                    target="_top"
                  >
                    Open in Shopify
                  </s-button>
                  <s-button variant="tertiary" onClick={onStartAgain}>
                    Make another
                  </s-button>
                </s-stack>
              </s-stack>
            </s-banner>
          ) : (
            <s-stack direction="inline" gap="small" alignItems="center">
              {web ? (
                <s-button
                  variant="primary"
                  onClick={async () => {
                    await navigator.clipboard
                      .writeText(descriptionHtml(l))
                      .catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied" : "Copy description HTML"}
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  disabled={!l.title.trim() || redo.state !== "idle"}
                  loading={create.state !== "idle"}
                  onClick={() =>
                    create.submit(
                      {
                        intent: "create",
                        listing: JSON.stringify(l),
                        imageIds: JSON.stringify(draft.imageIds),
                      },
                      { method: "post" },
                    )
                  }
                >
                  Create draft product in Shopify
                </s-button>
              )}
              <s-button
                variant="tertiary"
                disabled={create.state !== "idle"}
                loading={redo.state !== "idle"}
                onClick={() =>
                  redo.submit(
                    {
                      intent: "redraft",
                      imageIds: JSON.stringify(draft.imageIds),
                      notes,
                    },
                    { method: "post" },
                  )
                }
              >
                Write it again
              </s-button>
              <s-button
                variant="tertiary"
                disabled={create.state !== "idle"}
                onClick={onStartAgain}
              >
                Start again with new photos
              </s-button>
            </s-stack>
          )}
          {createError && <s-banner tone="critical">{createError}</s-banner>}
          {redoError && <s-banner tone="critical">{redoError}</s-banner>}
        </s-stack>
      </s-section>
    </>
  );
}

const CSS = `
.sw-pp-drop { display: flex; flex-wrap: wrap; gap: 12px; padding: 14px; border: 1.5px dashed #c9cde0; border-radius: 14px; background: #fafbfe; }
.sw-pp-thumb { position: relative; width: 120px; height: 120px; }
.sw-pp-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; }
.sw-pp-thumb button { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; border: none; background: rgba(0,0,0,.6); color: #fff; cursor: pointer; font-size: 16px; line-height: 1; }
.sw-pp-add { width: 220px; height: 120px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; text-align: center; border-radius: 10px; background: #fff; border: 1px solid #e1e4ef; cursor: pointer; padding: 8px; box-sizing: border-box; }
.sw-pp-add input { display: none; }
.sw-pp-add strong { color: var(--sw-accent, #6d5dfc); font-size: 14px; }
.sw-pp-add span { font-size: 12px; color: #6b7287; }
.sw-pp-strip { display: flex; flex-wrap: wrap; gap: 10px; }
.sw-pp-strip img { width: 96px; height: 96px; object-fit: cover; border-radius: 10px; background: #f1f1f4; }
.sw-pp-grid { display: flex; flex-direction: column; gap: 12px; }
.sw-pp-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.sw-pp-comp { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.sw-pp-field { display: flex; flex-direction: column; gap: 4px; }
.sw-pp-field > span { display: flex; align-items: center; font-size: 12px; font-weight: 600; color: #5b6478; }
.sw-pp-field em { font-style: normal; font-weight: 400; color: #8a91a5; margin-left: 6px; }
.sw-pp-field em.sw-pp-over { color: #c4291c; font-weight: 600; }
.sw-pp-field small { font-size: 12px; color: #8a91a5; }
.sw-pp-field input, .sw-pp-field textarea, .sw-pp-field select, .sw-pp-attr input, .sw-pp-catsearch input { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #d6d9e6; border-radius: 9px; width: 100%; box-sizing: border-box; resize: vertical; background: #fff; }
.sw-pp-field input:focus, .sw-pp-field textarea:focus, .sw-pp-attr input:focus { outline: none; border-color: var(--sw-accent, #6d5dfc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sw-accent, #6d5dfc) 18%, transparent); }
.sw-pp-catsearch { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.sw-pp-attrs { display: flex; flex-direction: column; gap: 8px; }
.sw-pp-attr { display: grid; grid-template-columns: 1fr 2fr 32px; gap: 8px; align-items: center; }
.sw-pp-attr button { border: none; background: none; font-size: 18px; color: #8a91a5; cursor: pointer; }
.sw-pp-check { margin: 4px 0 0; padding-left: 18px; }
`;

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
