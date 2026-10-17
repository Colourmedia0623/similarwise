import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { contentCalendar, deletePost, editPost, planCalendar, setCalendarPublish, writePost } from "../lib/ideas/calendar.server";
import type { Graphql } from "../lib/prices/prices.server";

// Content calendar: a blog post a day planned from the keyword gap, each
// written and sent to the shop's blog on its day.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return contentCalendar(session.shop);
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
  const done = posts.filter((p) => p.status === "done").reverse();

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
              {p.url && (
                <s-link href={p.url} target="_blank">
                  View on your store
                </s-link>
              )}
              {p.status === "done" && !p.url && <Link to="/app/articles">Read it</Link>}
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
.sw-post { display: grid; grid-template-columns: 56px 1fr; gap: 16px; align-items: start; }
.sw-day { display: flex; flex-direction: column; align-items: center; padding: 6px 0; border-radius: 8px; background: #f1f1f1; color: #616161; font-size: 12px; line-height: 1.3; }
.sw-day strong { font-size: 20px; color: #303030; }
.sw-today { background: #2a78d6; color: #fff; }
.sw-today strong { color: #fff; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
