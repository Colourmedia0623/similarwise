import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { addPost, contentCalendar, deletePost, editPost, planCalendar, setCalendarPublish, writePost } from "../lib/ideas/calendar.server";
import type { Graphql } from "../lib/prices/prices.server";
import { atOrigin, storeOrigin } from "../lib/ideas/articles.server";

// Content calendar: a blog post a day planned from the keyword gap, each
// written and sent to the shop's blog on its day.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
  const [calendar, origin] = await Promise.all([contentCalendar(session.shop), storeOrigin(graphql)]);
  return { ...calendar, posts: calendar.posts.map((p) => ({ ...p, url: atOrigin(p.url, origin) })) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");
  const text = (k: string) => String(form.get(k) ?? "");
  if (intent === "publish") {
    await setCalendarPublish(shop, form.get("publish") === "true");
    return { intent, ok: true as const };
  }
  if (intent === "plan" || intent === "suggest") {
    try {
      return { intent, ...(await planCalendar(shop, undefined, undefined, intent === "suggest" ? text("day") : undefined)) };
    } catch (err) {
      console.error("Couldn't plan the content calendar", shop, err);
      return { intent, error: "Couldn't plan posts just now. Try again in a minute." };
    }
  }
  if (intent === "delete") {
    const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
    return { intent, id, ...(await deletePost(shop, id, graphql)) };
  }
  if (intent === "add") return { intent, ...(await addPost(shop, { day: text("day"), keyword: text("keyword"), title: text("title"), angle: text("angle") })) };
  if (intent === "edit") return { intent, id, ...(await editPost(shop, id, { day: text("day"), keyword: text("keyword"), title: text("title"), angle: text("angle") })) };
  if (intent === "write") {
    const graphql: Graphql = async (query, variables) => (await admin.graphql(query, { variables })).json();
    return { intent, id, ...(await writePost(shop, id, graphql)) };
  }
  return { error: "Unknown action" };
};

type Post = ReturnType<typeof useLoaderData<typeof loader>>["posts"][number];

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

export default function Calendar() {
  const { posts, publish, today } = useLoaderData<typeof loader>();
  const plan = useFetcher<typeof action>();
  const setting = useFetcher<typeof action>();
  const planned = plan.data && "count" in plan.data ? plan.data.count : null;
  const planError = plan.data && "error" in plan.data ? plan.data.error : null;
  const publishing = setting.formData ? setting.formData.get("publish") === "true" : publish;
  const upcoming = posts.filter((p) => p.status !== "done");
  // Posts that went out more than a fortnight ago stay on the month view only.
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86400_000).toISOString().slice(0, 10);
  const done = posts.filter((p) => p.status === "done" && p.day >= since).reverse();
  const [selected, setSelected] = useState<{ id: string; edit: boolean } | null>(null);
  const picked = posts.find((p) => p.id === selected?.id);
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <s-page heading="Content calendar">
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            A blog post a day, each aimed at a Google search your competitors win and you don&apos;t, from your{" "}
            <s-link href="/app/keywords">keyword gap</s-link>. Change or delete any of them. Each one is written on its day, linking to your own
            products, and added to your Shopify blog.
          </s-paragraph>
          <s-checkbox
            label="Publish posts on their day"
            details={publishing ? "Posts go live on your blog as soon as they're written." : "Posts are added as hidden drafts, for you to read and publish in Shopify."}
            checked={publishing}
            disabled={setting.state !== "idle"}
            onChange={(e) => setting.submit({ intent: "publish", publish: String(e.currentTarget.checked) }, { method: "post" })}
          />
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button variant="primary" loading={plan.state !== "idle"} onClick={() => plan.submit({ intent: "plan" }, { method: "post" })}>
              {upcoming.length ? "Plan 30 more days" : "Plan the next 30 days"}
            </s-button>
            {plan.state !== "idle" && <s-text color="subdued">Planning takes about a minute.</s-text>}
          </s-stack>
          {planError && <s-banner tone="warning">{planError}</s-banner>}
          {planned != null && plan.state === "idle" && <s-banner tone="success">{planned} posts added to the calendar.</s-banner>}
        </s-stack>
      </s-section>

      <s-section heading="Month view">
        <MonthGrid
          posts={posts}
          today={today}
          selected={selected?.id ?? adding}
          onSelect={(id, edit = false) => {
            setSelected({ id, edit });
            setAdding(null);
          }}
          onAdd={(day) => {
            setAdding(day);
            setSelected(null);
          }}
        />
        {adding && <AddPost key={adding} day={adding} today={today} onDone={() => setAdding(null)} />}
        {picked && (
          <div className="sw-picked">
            <PostRow key={`${picked.id}-${selected?.edit}`} p={picked} today={today} edit={selected?.edit} />
          </div>
        )}
      </s-section>

      <s-section heading="Coming up">
        {upcoming.length === 0 ? (
          <s-paragraph>Nothing planned yet. Press Plan the next 30 days to fill the calendar.</s-paragraph>
        ) : (
          <s-stack gap="small">
            {upcoming.map((p) => (
              <PostRow key={p.id} p={p} today={today} />
            ))}
          </s-stack>
        )}
      </s-section>

      {done.length > 0 && (
        <s-section heading="Recently added to your blog">
          <s-stack gap="small">
            {done.map((p) => (
              <PostRow key={p.id} p={p} today={today} />
            ))}
          </s-stack>
        </s-section>
      )}
      <style>{CSS}</style>
    </s-page>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATE = { planned: "Planned", writing: "Writing", failed: "Didn't go out", done: "On your blog" } as const;

// A month at a time, Monday first, each day showing its post. Pressing a post
// opens it below the grid to change, write now or delete.
function MonthGrid({ posts, today, selected, onSelect, onAdd }: { posts: Post[]; today: string; selected: string | null; onSelect: Select; onAdd: (day: string) => void }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, i) => {
    const n = i - lead + 1;
    return n >= 1 && n <= daysIn ? `${month}-${String(n).padStart(2, "0")}` : null;
  });
  const byDay = new Map<string, Post[]>();
  for (const p of posts) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
  const shift = (n: number) => setMonth(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1)).toISOString().slice(0, 7));
  const count = posts.filter((p) => p.day.startsWith(month)).length;

  return (
    <div className="sw-month">
      <div className="sw-month-head">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <strong>{first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
        <button type="button" onClick={() => shift(1)} aria-label="Next month">›</button>
        <span className="sw-month-count">{count === 1 ? "1 post" : `${count} posts`}</span>
      </div>
      <div className="sw-grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="sw-weekday">{d}</div>
        ))}
        {cells.map((day, i) => (
          <div key={day ?? `blank-${i}`} className={`sw-cell${day ? "" : " sw-blank"}${day === today ? " sw-cell-today" : ""}${day && day < today ? " sw-past" : ""}`}>
            {day && <span className="sw-date">{Number(day.slice(8))}</span>}
            {day && (byDay.get(day) ?? []).map((p) => <DayTile key={p.id} p={p} on={p.id === selected} onSelect={onSelect} />)}
            {day && day >= today && !byDay.get(day)?.length && (
              <button type="button" className={`sw-add${selected === day ? " sw-add-on" : ""}`} onClick={() => onAdd(day)}>
                + Add a post
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="sw-legend">
        {(["planned", "writing", "done", "failed"] as const).map((s) => (
          <span key={s}>
            <i className={`sw-dot sw-chip-${s}`} />
            {STATE[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

type Select = (id: string, edit?: boolean) => void;

// A post that's been written goes with its article, off the blog too, so
// that one asks first.
const remove = (p: Post, submit: ReturnType<typeof useFetcher>["submit"]) => {
  if (p.articleId && !confirm(p.shopifyId ? "Delete this post? Its article comes off your blog too." : "Delete this post and its article?")) return;
  void submit({ intent: "delete", id: p.id }, { method: "post" });
};

// Fills an empty day: Claude suggests a post from the keyword gap, or the
// merchant writes the plan.
function AddPost({ day, today, onDone }: { day: string; today: string; onDone: () => void }) {
  const act = useFetcher<typeof action>();
  const [draft, setDraft] = useState({ day, keyword: "", title: "", angle: "" });
  const busy = (intent: string) => act.state !== "idle" && act.formData?.get("intent") === intent;
  const data = act.state === "idle" ? act.data : undefined;
  const error = data && "error" in data ? data.error : null;
  const added = !!data && !error;
  useEffect(() => {
    if (added) onDone();
  }, [added, onDone]);
  return (
    <div className="sw-picked">
      <s-box padding="base" border="base" borderRadius="base">
        <s-stack gap="base">
          <s-heading>Add a post on {dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}</s-heading>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button variant="primary" loading={busy("suggest")} onClick={() => act.submit({ intent: "suggest", day }, { method: "post" })}>
              Suggest one for me
            </s-button>
            <s-text color="subdued">Picks a search from your keyword gap that doesn&apos;t have a post yet.</s-text>
          </s-stack>
          <s-text color="subdued">Or plan it yourself:</s-text>
          <s-text-field label="Title" value={draft.title} onInput={(e) => setDraft({ ...draft, title: e.currentTarget.value })} />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small">
            <s-text-field label="Google search it targets" value={draft.keyword} onInput={(e) => setDraft({ ...draft, keyword: e.currentTarget.value })} />
            <s-date-field label="Day" value={draft.day} allow={`${today}--`} onChange={(e) => setDraft({ ...draft, day: e.currentTarget.value })} />
          </s-grid>
          <s-text-area label="What it covers" value={draft.angle} rows={2} onInput={(e) => setDraft({ ...draft, angle: e.currentTarget.value })} />
          {error && <s-banner tone="warning">{error}</s-banner>}
          <s-stack direction="inline" gap="small">
            <s-button loading={busy("add")} onClick={() => act.submit({ intent: "add", ...draft }, { method: "post" })}>
              Add to the calendar
            </s-button>
            <s-button variant="tertiary" onClick={onDone}>
              Cancel
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>
    </div>
  );
}

const PENCIL = "M14.7 2.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L7.4 15.6 3 17l1.4-4.4L14.7 2.3Z";
const BIN = "M7 2h6v2h4v2H3V4h4V2Zm-2 5h10l-1 11H6L5 7Z";
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
);

// A post on its day in the month view: its picture, title, search, when it
// goes out, and the next thing to do with it.
function DayTile({ p, on, onSelect }: { p: Post; on: boolean; onSelect: Select }) {
  const act = useFetcher<typeof action>();
  const busy = (intent: string) => act.state !== "idle" && act.formData?.get("intent") === intent;
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;
  if (busy("delete")) return null;
  const writing = p.status === "writing" || busy("write");
  const editable = !writing && (p.status === "planned" || p.status === "failed");
  const state = writing ? "writing" : p.status;
  const when = dayLabel(p.day, { weekday: "short", day: "numeric", month: "short" });
  const line = {
    planned: `Will be written on ${when}`,
    writing: "Being written now",
    failed: "Didn't go out. Try again.",
    done: p.sentAs === "draft" ? `Hidden draft since ${when}` : `On your blog since ${when}`,
  }[state as "planned"];

  return (
    <div className={`sw-tile sw-tile-${state}${on ? " sw-tile-on" : ""}`}>
      {!writing && (
        <div className="sw-tile-tools">
          {editable && (
            <button type="button" aria-label="Change this post" title="Change" onClick={() => onSelect(p.id, true)}>
              <Icon d={PENCIL} />
            </button>
          )}
          <button type="button" className="sw-tile-bin" aria-label="Delete this post" title="Delete" onClick={() => remove(p, act.submit)}>
            <Icon d={BIN} />
          </button>
        </div>
      )}
      {error && <span className="sw-tile-error">{error}</span>}
      <button type="button" className="sw-tile-main" onClick={() => onSelect(p.id)}>
        {p.picture && <img src={p.picture} alt="" />}
        <strong className="sw-tile-title">{p.title}</strong>
        <span className="sw-tile-term">
          <b>Search term:</b> {p.keyword}
        </span>
        <span className="sw-tile-when">{line ?? STATE[p.status as keyof typeof STATE]}</span>
      </button>
      {editable && (
        <button type="button" className="sw-tile-go" onClick={() => act.submit({ intent: "write", id: p.id }, { method: "post" })}>
          <Icon d={PENCIL} />
          {p.status === "failed" ? "Try again" : "Write now"}
        </button>
      )}
      {writing && <span className="sw-tile-go sw-tile-wait">Writing…</span>}
      {p.status === "done" && p.articleId && (
        <Link className="sw-tile-go" to={`/app/articles/${p.articleId}`}>
          Edit article
        </Link>
      )}
    </div>
  );
}

function PostRow({ p, today, edit = false }: { p: Post; today: string; edit?: boolean }) {
  const act = useFetcher<typeof action>();
  const [editing, setEditing] = useState(edit);
  const [draft, setDraft] = useState({ day: p.day, keyword: p.keyword, title: p.title, angle: p.angle });
  const busy = (intent: string) => act.state !== "idle" && act.formData?.get("intent") === intent;
  const result = act.data && "id" in act.data && act.data.id === p.id ? act.data : null;
  const error = act.state === "idle" && result && "error" in result ? result.error : null;
  if (busy("delete")) return null;
  const writing = p.status === "writing" || busy("write");
  const editable = p.status === "planned" || p.status === "failed";

  const save = () => {
    act.submit({ intent: "edit", id: p.id, ...draft }, { method: "post" });
    setEditing(false);
  };

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <div className="sw-post">
        <div className={`sw-day${p.day === today ? " sw-today" : ""}`}>
          <span>{dayLabel(p.day, { weekday: "short" })}</span>
          <strong>{dayLabel(p.day, { day: "numeric" })}</strong>
          <span>{dayLabel(p.day, { month: "short" })}</span>
        </div>
        <s-stack gap="small">
          {editing ? (
            <s-stack gap="small">
              <s-text-field label="Title" value={draft.title} onInput={(e) => setDraft({ ...draft, title: e.currentTarget.value })} />
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small">
                <s-text-field
                  label="Google search it targets"
                  value={draft.keyword}
                  onInput={(e) => setDraft({ ...draft, keyword: e.currentTarget.value })}
                />
                <s-date-field label="Day" value={draft.day} allow={`${today}--`} onChange={(e) => setDraft({ ...draft, day: e.currentTarget.value })} />
              </s-grid>
              <s-text-area label="What it covers" value={draft.angle} rows={2} onInput={(e) => setDraft({ ...draft, angle: e.currentTarget.value })} />
              <s-stack direction="inline" gap="small">
                <s-button variant="primary" onClick={save}>
                  Save
                </s-button>
                <s-button variant="tertiary" onClick={() => setEditing(false)}>
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          ) : (
            <>
              <s-heading>{p.title}</s-heading>
              <s-text color="subdued">
                For “{p.keyword}”{p.searchVolume != null ? `, ${compact(p.searchVolume)} searches a month` : ""}
              </s-text>
              {p.angle && <s-text>{p.angle}</s-text>}
            </>
          )}
          {(error || p.error) && <s-banner tone="warning">{error ?? p.error}</s-banner>}
          {!editing && (
            <s-stack direction="inline" gap="small" alignItems="center">
              <Status p={p} writing={writing} />
              {p.url && p.sentAs === "published" && (
                <s-link href={p.url} target="_blank">
                  View on your store
                </s-link>
              )}
              {p.shopifyId && (
                <s-link href={`shopify://admin/articles/${p.shopifyId.split("/").pop()}`} target="_blank">
                  Open in Shopify
                </s-link>
              )}
              {p.articleId && <Link to={`/app/articles/${p.articleId}`}>Open the article</Link>}
              {editable && !writing && (
                <>
                  <s-button onClick={() => act.submit({ intent: "write", id: p.id }, { method: "post" })}>{p.status === "failed" ? "Try again" : "Write now"}</s-button>
                  <s-button variant="tertiary" onClick={() => setEditing(true)}>
                    Edit
                  </s-button>
                </>
              )}
              {!writing && (
                <s-button variant="tertiary" tone="critical" onClick={() => remove(p, act.submit)}>
                  Delete
                </s-button>
              )}
              {busy("write") && <s-text color="subdued">Writing takes about a minute.</s-text>}
            </s-stack>
          )}
        </s-stack>
      </div>
    </s-box>
  );
}

function Status({ p, writing }: { p: Post; writing: boolean }) {
  if (writing) return <s-badge tone="info">Writing</s-badge>;
  if (p.status === "failed") return <s-badge tone="warning">Didn&apos;t go out</s-badge>;
  if (p.status === "done") return <s-badge tone="success">{p.sentAs === "draft" ? "Hidden draft on your blog" : "Published"}</s-badge>;
  return <s-badge>Planned</s-badge>;
}

const CSS = `
.sw-month-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 15px; }
.sw-month-head button { width: 30px; height: 30px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; font-size: 18px; line-height: 1; cursor: pointer; }
.sw-month-head button:hover { background: #f3f3f3; }
.sw-month-count { margin-left: auto; color: #616161; font-size: 13px; }
.sw-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid #e3e3e3; border-left: 1px solid #e3e3e3; border-radius: 10px; overflow: hidden; }
.sw-weekday { padding: 6px 8px; font-size: 12px; font-weight: 600; color: #616161; background: #f7f7f7; border-right: 1px solid #e3e3e3; border-bottom: 1px solid #e3e3e3; }
.sw-cell { min-height: 120px; padding: 8px; display: flex; flex-direction: column; gap: 4px; border-right: 1px solid #e3e3e3; border-bottom: 1px solid #e3e3e3; background: #fff; min-width: 0; }
.sw-blank { background: #fafafa; }
.sw-past { background: #fcfcfc; }
.sw-date { font-size: 12px; color: #616161; }
.sw-cell-today .sw-date { align-self: flex-start; padding: 0 6px; border-radius: 8px; background: #2a78d6; color: #fff; font-weight: 600; }
.sw-tile { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid #c9dcf3; border-radius: 10px; background: #f4f8fd; min-width: 0; }
.sw-tile-on { outline: 2px solid #2a78d6; outline-offset: 1px; }
.sw-tile-main { display: flex; flex-direction: column; gap: 6px; padding: 0; border: 0; background: none; text-align: left; font: inherit; color: #303030; cursor: pointer; min-width: 0; }
.sw-tile-main img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 6px; }
.sw-tile-title { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; padding-right: 2px; font-size: 13px; line-height: 1.35; color: #1f5199; overflow-wrap: anywhere; }
.sw-tile-term { font-size: 12px; line-height: 1.35; color: #4a4a4a; overflow-wrap: anywhere; }
.sw-tile-term b { display: block; color: #303030; }
.sw-tile-when { font-size: 11px; line-height: 1.3; color: #2a78d6; }
.sw-tile-tools { position: absolute; top: 6px; right: 6px; z-index: 1; display: flex; gap: 4px; }
.sw-tile-tools button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 1px solid #e3e3e3; border-radius: 50%; background: #fff; color: #2a78d6; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.sw-tile-tools .sw-tile-bin { color: #d72c0d; }
.sw-tile-tools button:hover { background: #f3f3f3; }
.sw-tile:not(:has(img)) .sw-tile-tools { position: static; align-self: flex-end; margin: -2px -2px -4px 0; }
.sw-tile-go { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 4px; white-space: nowrap; border: 0; border-radius: 8px; background: #1a8f5e; color: #fff; font: inherit; font-size: 13px; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; }
.sw-tile-go:hover { background: #157a50; }
.sw-tile-wait { background: #eda100; cursor: default; }
.sw-tile-wait:hover { background: #eda100; }
.sw-tile-writing { border-color: #f1d089; background: #fff8e6; }
.sw-tile-writing .sw-tile-when { color: #8a5a00; }
.sw-tile-done { border-color: #a8e0c8; background: #eefaf4; }
.sw-tile-done .sw-tile-title { color: #0f6e45; }
.sw-tile-done .sw-tile-when { color: #0f6e45; }
.sw-tile-done .sw-tile-go { background: #fff; color: #0f6e45; border: 1px solid #a8e0c8; }
.sw-tile-done .sw-tile-go:hover { background: #f3fbf7; }
.sw-tile-failed { border-color: #f3b8b8; background: #fdf1f1; }
.sw-tile-failed .sw-tile-when { color: #c4291c; }
.sw-tile-error { font-size: 11px; color: #c4291c; }
.sw-add { flex: 1; min-height: 60px; border: 1px dashed transparent; border-radius: 10px; background: none; color: #8a8a8a; font: inherit; font-size: 12px; cursor: pointer; opacity: 0; transition: opacity .15s; }
.sw-cell:hover .sw-add, .sw-add:focus-visible, .sw-add-on { opacity: 1; border-color: #c9c9c9; }
.sw-add:hover, .sw-add-on { color: #2a78d6; border-color: #2a78d6; background: #f4f8fd; }
@media (hover: none) { .sw-add { opacity: 1; border-color: #e3e3e3; } }
.sw-chip-planned { background: #2a78d6; } .sw-chip-writing { background: #eda100; } .sw-chip-done { background: #1baf7a; } .sw-chip-failed { background: #e5484d; }
.sw-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12px; color: #616161; }
.sw-dot { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 3px; border: 0; vertical-align: -1px; }
.sw-picked { margin-top: 12px; }
@media (max-width: 900px) { .sw-tile-term, .sw-tile-when, .sw-tile-tools { display: none; } }
@media (max-width: 700px) { .sw-cell { min-height: 72px; } .sw-tile { padding: 4px; } .sw-tile-main img, .sw-tile-go { display: none; } .sw-tile-title { font-size: 11px; -webkit-line-clamp: 3; } }
.sw-post { display: grid; grid-template-columns: 56px 1fr; gap: 16px; align-items: start; }
.sw-day { display: flex; flex-direction: column; align-items: center; padding: 6px 0; border-radius: 8px; background: #f1f1f1; color: #616161; font-size: 12px; line-height: 1.3; }
.sw-day strong { font-size: 20px; color: #303030; }
.sw-today { background: #2a78d6; color: #fff; }
.sw-today strong { color: #fff; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
