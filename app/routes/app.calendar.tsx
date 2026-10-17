import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { contentCalendar, deletePost, editPost, planCalendar, setCalendarPublish, writePost } from "../lib/ideas/calendar.server";
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
  if (intent === "plan") {
    try {
      return { intent, ...(await planCalendar(shop)) };
    } catch (err) {
      console.error("Couldn't plan the content calendar", shop, err);
      return { intent, error: "Couldn't plan posts just now. Try again in a minute." };
    }
  }
  if (intent === "delete") {
    await deletePost(shop, id);
    return { intent, id, ok: true as const };
  }
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
  const [selected, setSelected] = useState<string | null>(null);
  const picked = posts.find((p) => p.id === selected);

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
        <MonthGrid posts={posts} today={today} selected={selected} onSelect={setSelected} />
        {picked && (
          <div className="sw-picked">
            <PostRow key={picked.id} p={picked} today={today} />
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
function MonthGrid({ posts, today, selected, onSelect }: { posts: Post[]; today: string; selected: string | null; onSelect: (id: string) => void }) {
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
            {day &&
              (byDay.get(day) ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`sw-chip sw-chip-${p.status}${p.id === selected ? " sw-chip-on" : ""}`}
                  title={`${p.title} (${STATE[p.status as keyof typeof STATE] ?? p.status})`}
                  onClick={() => onSelect(p.id)}
                >
                  {p.picture && <img src={p.picture} alt="" />}
                  <span>{p.title}</span>
                </button>
              ))}
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

function PostRow({ p, today }: { p: Post; today: string }) {
  const act = useFetcher<typeof action>();
  const [editing, setEditing] = useState(false);
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
                  <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "delete", id: p.id }, { method: "post" })}>
                    Delete
                  </s-button>
                </>
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
.sw-cell { min-height: 108px; padding: 6px; display: flex; flex-direction: column; gap: 4px; border-right: 1px solid #e3e3e3; border-bottom: 1px solid #e3e3e3; background: #fff; min-width: 0; }
.sw-blank { background: #fafafa; }
.sw-past { background: #fcfcfc; }
.sw-date { font-size: 12px; color: #616161; }
.sw-cell-today .sw-date { align-self: flex-start; padding: 0 6px; border-radius: 8px; background: #2a78d6; color: #fff; font-weight: 600; }
.sw-chip { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 4px; border: 0; border-left: 3px solid #8a8a8a; border-radius: 6px; background: #f3f3f3; text-align: left; font: inherit; font-size: 12px; line-height: 1.3; color: #303030; cursor: pointer; }
.sw-chip span { display: -webkit-box; -webkit-line-clamp: 2; padding-bottom: 1px; -webkit-box-orient: vertical; overflow: hidden; }
.sw-chip img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 4px; }
.sw-chip:hover { filter: brightness(.97); }
.sw-chip-on { outline: 2px solid #2a78d6; }
.sw-chip-planned { border-left-color: #2a78d6; background: #eef5fd; }
.sw-chip-writing { border-left-color: #eda100; background: #fff6e0; }
.sw-chip-done { border-left-color: #1baf7a; background: #e8f8f1; }
.sw-chip-failed { border-left-color: #e5484d; background: #fdecec; }
.sw-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12px; color: #616161; }
.sw-dot { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 3px; border: 0; vertical-align: -1px; }
.sw-dot.sw-chip-planned { background: #2a78d6; } .sw-dot.sw-chip-writing { background: #eda100; } .sw-dot.sw-chip-done { background: #1baf7a; } .sw-dot.sw-chip-failed { background: #e5484d; }
.sw-picked { margin-top: 12px; }
@media (max-width: 700px) { .sw-cell { min-height: 72px; } .sw-chip img, .sw-chip span { display: none; } .sw-chip { min-height: 10px; padding: 3px; } }
.sw-post { display: grid; grid-template-columns: 56px 1fr; gap: 16px; align-items: start; }
.sw-day { display: flex; flex-direction: column; align-items: center; padding: 6px 0; border-radius: 8px; background: #f1f1f1; color: #616161; font-size: 12px; line-height: 1.3; }
.sw-day strong { font-size: 20px; color: #303030; }
.sw-today { background: #2a78d6; color: #fff; }
.sw-today strong { color: #fff; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
