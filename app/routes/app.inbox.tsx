import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { claudeJson } from "../lib/ideas/claude.server";
import { NETWORK_NAME } from "../lib/social/networks";
import { INBOX_NETWORKS, REPLY_LIMIT, type InboxNetwork, type Kind } from "../lib/inbox/inbox";
import {
  answer,
  assign,
  deleteMember,
  deleteRule,
  draftReply,
  inboxView,
  saveMember,
  saveRule,
  setStatus,
  setTags,
  syncShop,
  toggleRule,
} from "../lib/inbox/inbox.server";
import { HowTo } from "../components/HowTo";

// The social inbox: comments and direct messages from the shop's Facebook
// Page, Instagram and LinkedIn in one place, answered, assigned and resolved
// from here, with automations that tag, route, answer and resolve.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const p = new URL(request.url).searchParams;
  const view = await inboxView(session.shop, { box: p.get("box"), network: p.get("network"), kind: p.get("kind"), tag: p.get("tag"), sentiment: p.get("sentiment"), q: p.get("q"), thread: p.get("t") });
  return { ...view, writer: claudeJson() != null, now: Date.now() };
};

const words = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const text = (k: string) => String(form.get(k) ?? "");
  const ids = form.getAll("id").map(String);
  if (intent === "refresh") return { intent, ...(await syncShop(shop)) };
  if (intent === "reply") return { intent, ...(await answer(shop, text("id"), text("text"), { resolve: text("resolve") === "true", by: text("by") || null })) };
  if (intent === "draft") {
    try {
      return { intent, ...(await draftReply(shop, text("id"))) };
    } catch (err) {
      console.error("Couldn't draft an inbox reply", shop, err);
      return { intent, error: "Couldn't write a reply just now. Try again in a minute." };
    }
  }
  if (intent === "resolve" || intent === "reopen") {
    await setStatus(shop, ids, intent === "resolve" ? "resolved" : "open");
    return { intent, ok: true as const };
  }
  if (intent === "assign") return { intent, ...(await assign(shop, ids, text("member") || null)) };
  if (intent === "tags") {
    await setTags(shop, text("id"), words(text("tags")));
    return { intent, ok: true as const };
  }
  if (intent === "member") return { intent, ...(await saveMember(shop, { id: text("memberId") || undefined, name: text("name"), skills: words(text("skills")), routing: text("routing") === "true" })) };
  if (intent === "member-delete") {
    await deleteMember(shop, text("memberId"));
    return { intent, ok: true as const };
  }
  if (intent === "rule")
    return {
      intent,
      ...(await saveRule(shop, {
        id: text("ruleId") || undefined,
        name: text("name"),
        on: text("on") !== "false",
        networks: form.getAll("networks").map(String),
        kinds: form.getAll("kinds").map(String),
        words: words(text("words")),
        sentiment: text("sentiment"),
        addTags: words(text("addTags")),
        assignTo: text("assignTo"),
        reply: text("reply"),
        resolve: text("resolve") === "true",
      })),
    };
  if (intent === "rule-toggle") {
    await toggleRule(shop, text("ruleId"), text("on") === "true");
    return { intent, ok: true as const };
  }
  if (intent === "rule-delete") {
    await deleteRule(shop, text("ruleId"));
    return { intent, ok: true as const };
  }
  return { error: "Unknown action" };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Rule = Data["rules"][number];
type Member = Data["members"][number];

const NET_COLOR: Record<InboxNetwork, string> = { facebook: "#1877f2", instagram: "#d6249f", linkedin: "#0a66c2" };
const FEEL = { positive: { label: "Positive", color: "#1baf7a" }, neutral: { label: "Neutral", color: "#9a9a9a" }, negative: { label: "Negative", color: "#e5484d" } } as const;

function NetIcon({ n, size = 16 }: { n: InboxNetwork; size?: number }) {
  return (
    <span className="ib-net" style={{ width: size, height: size, background: n === "instagram" ? "linear-gradient(45deg,#f9a825,#e1306c 55%,#833ab4)" : NET_COLOR[n] }} title={NETWORK_NAME[n]}>
      <svg viewBox="0 0 16 16" width={size * 0.66} height={size * 0.66} aria-hidden="true">
        {n === "facebook" && <path fill="#fff" d="M9.2 16V9h2.3l.4-2.7H9.2V4.6c0-.8.2-1.3 1.3-1.3H12V.9C11.7.8 10.9.8 10 .8 8 .8 6.6 2 6.6 4.2v2.1H4.3V9h2.3v7h2.6Z" />}
        {n === "instagram" && (
          <g fill="none" stroke="#fff" strokeWidth="1.6">
            <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="3.6" />
            <circle cx="8" cy="8" r="3" />
          </g>
        )}
        {n === "linkedin" && (
          <path fill="#fff" d="M1.5 5.5h2.9V15H1.5V5.5ZM3 1a1.7 1.7 0 1 1 0 3.4A1.7 1.7 0 0 1 3 1Zm3.3 4.5h2.8v1.3c.4-.7 1.4-1.5 2.8-1.5 3 0 3.6 2 3.6 4.5V15h-2.9v-4.6c0-1.1 0-2.5-1.5-2.5s-1.8 1.2-1.8 2.4V15H6.3V5.5Z" />
        )}
      </svg>
    </span>
  );
}

function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const initials = (name: string) =>
  name
    .replace(/^@/, "")
    .split(/[\s._]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export default function Inbox() {
  const d = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const refresh = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const set = (k: string, v: string | null, keepThread = false) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (!keepThread) next.delete("t");
    setParams(next, { preventScrollReset: true });
  };

  // New comments and messages come in every few minutes.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && revalidator.revalidate(), 60_000);
    return () => clearInterval(t);
  }, [revalidator]);

  const syncing = refresh.state !== "idle";
  const lastSync = d.accounts.map((a) => a.syncedAt).filter(Boolean).sort().pop();
  const errors = d.accounts.filter((a) => a.error);
  const change = d.counts.resolvedYesterday ? Math.round((100 * (d.counts.resolvedToday - d.counts.resolvedYesterday)) / d.counts.resolvedYesterday) : null;
  const felt = d.sentiment.positive + d.sentiment.neutral + d.sentiment.negative;

  if (!d.networks.length)
    return (
      <s-page heading="Social inbox">
        <s-section>
          <s-banner tone="info">The social inbox is coming soon. It&apos;ll bring the comments and messages from your Facebook Page, Instagram and LinkedIn into one place.</s-banner>
        </s-section>
      </s-page>
    );

  return (
    <s-page heading="Social inbox" inlineSize="large">
      <HowTo video="social-inbox" />
      {d.accounts.length > 0 && (
        <s-button slot="primary-action" variant="primary" loading={syncing} onClick={() => refresh.submit({ intent: "refresh" }, { method: "post" })}>
          Check for new messages
        </s-button>
      )}
      {!d.accounts.length && (
        <s-section>
          <s-stack gap="base">
            <s-paragraph>
              Answer every comment and direct message from your {d.networks.map((n) => NETWORK_NAME[n]).join(", ").replace(/, ([^,]*)$/, " and $1")} in one place, with automated replies, tags and your team.
            </s-paragraph>
            <s-banner tone="info">
              Connect your accounts on the <s-link href="/app/social">Social accounts</s-link> page to start. Your comments and messages appear here a few minutes later.
            </s-banner>
          </s-stack>
        </s-section>
      )}
      {errors.map((a) => (
        <s-banner key={a.id} tone="warning">
          {a.name}: {a.error}
        </s-banner>
      ))}

      {d.accounts.length > 0 && (
        <>
          <div className="ib-stats">
            <Stat label="Needs action" value={d.counts.action} hint="No one on it, or waiting over an hour" tone={d.counts.action ? "warn" : undefined} onClick={() => set("box", "action")} />
            <Stat label="Open now" value={d.counts.open} hint={`${d.counts.unassigned} not assigned`} onClick={() => set("box", "open")} />
            <Stat
              label="Resolved today"
              value={d.counts.resolvedToday}
              hint={change == null ? `${d.counts.resolvedYesterday} yesterday` : `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}% vs yesterday`}
              onClick={() => set("box", "resolved")}
            />
            <div className="ib-stat">
              <span>Sentiment, last 7 days</span>
              {felt ? (
                <>
                  <div className="ib-sentbar" aria-label={`${d.sentiment.positive} positive, ${d.sentiment.neutral} neutral, ${d.sentiment.negative} negative`}>
                    {(["positive", "neutral", "negative"] as const).map((k) => d.sentiment[k] > 0 && <i key={k} style={{ flexGrow: d.sentiment[k], background: FEEL[k].color }} />)}
                  </div>
                  <small>
                    {(["positive", "neutral", "negative"] as const).map((k) => (
                      <button key={k} type="button" className="ib-link" onClick={() => set("sentiment", k)}>
                        {Math.round((100 * d.sentiment[k]) / felt)}% {k}
                      </button>
                    ))}
                  </small>
                </>
              ) : (
                <small>{d.writer ? "Read as messages come in" : "Needs the AI writer switched on"}</small>
              )}
            </div>
          </div>

          <div className="ib-shell">
            <Boxes d={d} set={set} />
            <List d={d} params={params} set={set} />
            <Conversation key={d.selected?.id ?? "none"} d={d} />
          </div>
          <s-text color="subdued">
            {lastSync ? `Checked ${ago(lastSync)}. ` : ""}New comments and messages come in every five minutes.
            {d.networks.length < INBOX_NETWORKS.length && ` ${INBOX_NETWORKS.filter((n) => !d.networks.includes(n)).map((n) => NETWORK_NAME[n]).join(" and ")} coming soon.`}
          </s-text>
        </>
      )}

      <Automations d={d} />
      <Team d={d} />
      <style>{CSS}</style>
    </s-page>
  );
}

function Stat({ label, value, hint, tone, onClick }: { label: string; value: number; hint: string; tone?: "warn"; onClick: () => void }) {
  return (
    <button type="button" className={`ib-stat ib-stat-btn${tone ? " ib-warn" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </button>
  );
}

function Boxes({ d, set }: { d: Data; set: (k: string, v: string | null) => void }) {
  const item = (box: string, label: string, count?: number) => (
    <button key={box} type="button" className={`ib-box${d.box === box ? " ib-on" : ""}`} onClick={() => set("box", box)}>
      <span>{label}</span>
      {count != null && <b>{count}</b>}
    </button>
  );
  return (
    <nav className="ib-boxes" aria-label="Inbox views">
      <h3>Inbox</h3>
      {item("action", "Needs action", d.counts.action)}
      {item("open", "All open", d.counts.open)}
      {item("unassigned", "Not assigned", d.counts.unassigned)}
      {d.members.map((m) => item(`member:${m.id}`, m.name, d.counts.members[m.id] ?? 0))}
      {item("resolved", "Resolved")}
      {item("all", "Everything")}
      {d.tags.length > 0 && (
        <>
          <h3>Tags</h3>
          <div className="ib-tagcloud">
            {d.tags.slice(0, 16).map((t) => (
              <button key={t.tag} type="button" className="ib-tag" onClick={() => set("tag", t.tag)}>
                {t.tag} <em>{t.count}</em>
              </button>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}

function List({ d, params, set }: { d: Data; params: URLSearchParams; set: (k: string, v: string | null, keep?: boolean) => void }) {
  const [q, setQ] = useState(params.get("q") ?? "");
  const bulk = useFetcher<typeof action>();
  const [picked, setPicked] = useState<string[]>([]);
  const filtered = ["network", "kind", "sentiment", "tag", "q"].filter((k) => params.get(k));
  const doBulk = (intent: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    for (const id of picked) fd.append("id", id);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    bulk.submit(fd, { method: "post" });
    setPicked([]);
  };
  return (
    <section className="ib-list" aria-label="Conversations">
      <form
        className="ib-search"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", q.trim() || null);
        }}
      >
        <input type="search" placeholder="Search all conversations" value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search all conversations" />
      </form>
      <div className="ib-filters">
        <select value={params.get("network") ?? ""} onChange={(e) => set("network", e.currentTarget.value || null)} aria-label="Channel">
          <option value="">All channels</option>
          {d.networks.map((n) => (
            <option key={n} value={n}>
              {NETWORK_NAME[n]}
            </option>
          ))}
        </select>
        <select value={params.get("kind") ?? ""} onChange={(e) => set("kind", e.currentTarget.value || null)} aria-label="Type">
          <option value="">Comments and messages</option>
          <option value="comment">Public comments</option>
          <option value="message">Private messages</option>
        </select>
        {filtered.length > 0 && (
          <button
            type="button"
            className="ib-link"
            onClick={() => {
              setQ("");
              const next = new URLSearchParams(params);
              for (const k of filtered) next.delete(k);
              next.delete("t");
              set("box", next.get("box"));
            }}
          >
            Clear {params.get("tag") ? `“${params.get("tag")}”` : params.get("sentiment") ? params.get("sentiment") : "filters"}
          </button>
        )}
      </div>
      {picked.length > 0 && (
        <div className="ib-bulk">
          <span>{picked.length} picked</span>
          {d.box !== "resolved" ? (
            <button type="button" onClick={() => doBulk("resolve")}>
              Resolve
            </button>
          ) : (
            <button type="button" onClick={() => doBulk("reopen")}>
              Reopen
            </button>
          )}
          {d.members.length > 0 && (
            <select value="" onChange={(e) => e.currentTarget.value && doBulk("assign", { member: e.currentTarget.value === "-" ? "" : e.currentTarget.value })} aria-label="Assign to">
              <option value="">Assign to…</option>
              {d.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="-">No one</option>
            </select>
          )}
        </div>
      )}
      <div className="ib-items">
        {!d.threads.length && <p className="ib-empty">{filtered.length ? "Nothing matches." : d.box === "action" || d.box === "open" ? "All caught up. Nothing waiting." : "Nothing here yet."}</p>}
        {d.threads.map((t) => (
          <div key={t.id} className={`ib-item${d.selected?.id === t.id ? " ib-on" : ""}${t.status === "open" && t.lastFrom === "them" ? " ib-waiting" : ""}`}>
            <input
              type="checkbox"
              checked={picked.includes(t.id)}
              onChange={(e) => setPicked(e.currentTarget.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))}
              aria-label={`Pick ${t.contactName}`}
            />
            <button type="button" className="ib-itembtn" onClick={() => set("t", t.id, true)}>
              <span className="ib-avatar">
                {initials(t.contactName)}
                <NetIcon n={t.network} size={15} />
              </span>
              <span className="ib-itemtext">
                <span className="ib-itemtop">
                  <strong>{t.contactName}</strong>
                  <time>{ago(t.lastAt)}</time>
                </span>
                <span className="ib-preview">
                  {t.lastFrom === "us" ? "You: " : ""}
                  {t.lastText}
                </span>
                <span className="ib-chips">
                  <span className="ib-chip">{t.kind === "message" ? "Private" : "Public"}</span>
                  {t.sentiment && <span className="ib-dot" style={{ background: FEEL[t.sentiment].color }} title={FEEL[t.sentiment].label} />}
                  {t.tags.slice(0, 2).map((x) => (
                    <span key={x} className="ib-chip ib-chip-tag">
                      {x}
                    </span>
                  ))}
                  {t.assigneeName && <span className="ib-chip ib-chip-who">{t.assigneeName}</span>}
                  {t.status === "resolved" && <span className="ib-chip ib-chip-done">Resolved</span>}
                </span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Conversation({ d }: { d: Data }) {
  const t = d.selected;
  const send = useFetcher<typeof action>();
  const draft = useFetcher<typeof action>();
  const act = useFetcher<typeof action>();
  const [text, setText] = useState("");
  const [tags, setTagsText] = useState(t?.tags.join(", ") ?? "");
  const [by, setBy] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // The newest message in view, without moving the page.
  useEffect(() => {
    if (end.current) end.current.scrollTop = end.current.scrollHeight;
  }, [t?.messages.length]);
  // A suggested reply fills the box; a sent one empties it.
  const [seen, setSeen] = useState({ draft: draft.data, send: send.data });
  if (draft.state === "idle" && draft.data !== seen.draft) {
    setSeen({ ...seen, draft: draft.data });
    if (draft.data && "reply" in draft.data && draft.data.reply) setText(draft.data.reply);
  }
  if (send.state === "idle" && send.data !== seen.send) {
    setSeen({ ...seen, send: send.data });
    if (send.data && "ok" in send.data) setText("");
  }
  if (!t)
    return (
      <section className="ib-convo ib-convo-empty">
        <p>Pick a conversation to read and answer it.</p>
      </section>
    );
  const limit = REPLY_LIMIT[t.network];
  const sendError = send.state === "idle" && send.data && "error" in send.data ? send.data.error : null;
  const draftError = draft.state === "idle" && draft.data && "error" in draft.data ? draft.data.error : null;
  const submit = (resolve: boolean) => send.submit({ intent: "reply", id: t.id, text, resolve: String(resolve), by }, { method: "post" });
  const waitingDays = t.kind === "message" && t.waitingSince ? (d.now - new Date(t.waitingSince).getTime()) / 86400_000 : 0;
  return (
    <section className="ib-convo" aria-label={`Conversation with ${t.contactName}`}>
      <header className="ib-convohead">
        <div>
          <strong>{t.contactName}</strong>
          <small>
            <NetIcon n={t.network} size={14} /> {t.kind === "message" ? "Direct message" : "Comment"} to {t.account}
            {t.postUrl && (
              <>
                {" · "}
                <a href={t.postUrl} target="_blank" rel="noreferrer">
                  See the post
                </a>
              </>
            )}
          </small>
        </div>
        <div className="ib-convoacts">
          <select value={t.assignee ?? ""} onChange={(e) => act.submit({ intent: "assign", id: t.id, member: e.currentTarget.value }, { method: "post" })} aria-label="Assigned to" disabled={!d.members.length}>
            <option value="">{d.members.length ? "Not assigned" : "Add teammates below"}</option>
            {d.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {t.status === "open" ? (
            <s-button onClick={() => act.submit({ intent: "resolve", id: t.id }, { method: "post" })} loading={act.state !== "idle" && act.formData?.get("intent") === "resolve"}>
              Resolve
            </s-button>
          ) : (
            <s-button onClick={() => act.submit({ intent: "reopen", id: t.id }, { method: "post" })}>Reopen</s-button>
          )}
        </div>
      </header>
      {t.postText && t.kind === "comment" && <blockquote className="ib-post">On your post: {t.postText.length > 160 ? `${t.postText.slice(0, 160)}…` : t.postText}</blockquote>}
      <div className="ib-msgs" ref={end}>
        {t.messages.map((m) => (
          <div key={m.id} className={`ib-msg${m.fromUs ? " ib-us" : ""}`}>
            <p>{m.text}</p>
            <small>
              {m.fromUs ? (m.auto ? "Automated reply" : m.by ? m.by : "You") : m.author} · {ago(m.at)}
            </small>
          </div>
        ))}
      </div>
      <div className="ib-tagsrow">
        <input
          value={tags}
          onChange={(e) => setTagsText(e.currentTarget.value)}
          onBlur={() => tags !== t.tags.join(", ") && act.submit({ intent: "tags", id: t.id, tags }, { method: "post" })}
          placeholder="Add tags, separated by commas"
          aria-label="Tags"
        />
        {t.sentiment && (
          <span className="ib-chip" style={{ color: FEEL[t.sentiment].color }}>
            {FEEL[t.sentiment].label}
          </span>
        )}
      </div>
      <div className="ib-compose">
        {waitingDays > 1 && waitingDays <= 7 && <s-text color="subdued">It&apos;s been over a day, so this goes as a reply from your team, which Meta allows for up to seven days.</s-text>}
        {waitingDays > 7 && <s-banner tone="warning">It&apos;s been more than seven days since their message, so Meta won&apos;t let a reply through until they write again.</s-banner>}
        <textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          rows={3}
          maxLength={limit}
          placeholder={t.kind === "comment" ? `Reply publicly to ${t.contactName}` : `Message ${t.contactName}`}
          aria-label="Your reply"
        />
        {sendError && <s-banner tone="critical">{sendError}</s-banner>}
        {draftError && <s-banner tone="warning">{draftError}</s-banner>}
        <div className="ib-composeacts">
          {d.writer && (
            <s-button variant="tertiary" icon="wand" loading={draft.state !== "idle"} onClick={() => draft.submit({ intent: "draft", id: t.id }, { method: "post" })}>
              Suggest a reply
            </s-button>
          )}
          <span className="ib-count">
            {text.length}/{limit}
          </span>
          {d.members.length > 0 && (
            <select value={by} onChange={(e) => setBy(e.currentTarget.value)} aria-label="Answering as">
              <option value="">Answering as…</option>
              {d.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <s-button disabled={!text.trim()} loading={send.state !== "idle" && send.formData?.get("resolve") === "true"} onClick={() => submit(true)}>
            Send and resolve
          </s-button>
          <s-button variant="primary" disabled={!text.trim()} loading={send.state !== "idle" && send.formData?.get("resolve") === "false"} onClick={() => submit(false)}>
            Send
          </s-button>
        </div>
      </div>
    </section>
  );
}

const emptyRule = (): Omit<Rule, "id"> & { id: string } => ({ id: "", name: "", on: true, networks: [], kinds: [], words: [], sentiment: "", addTags: [], assignTo: "", reply: "", resolve: false });

function Automations({ d }: { d: Data }) {
  const [editing, setEditing] = useState<ReturnType<typeof emptyRule> | null>(null);
  const act = useFetcher<typeof action>();
  const memberName = new Map(d.members.map((m) => [m.id, m.name]));
  const describe = (r: Rule) => {
    const when = [
      r.kinds.length === 1 ? (r.kinds[0] === "message" ? "a direct message" : "a comment") : "a comment or message",
      r.networks.length ? `on ${r.networks.map((n) => NETWORK_NAME[n as InboxNetwork]).join(" or ")}` : "",
      r.words.length ? `says “${r.words.slice(0, 3).join("”, “")}”${r.words.length > 3 ? "…" : ""}` : "",
      r.sentiment ? `reads ${r.sentiment}` : "",
    ].filter(Boolean);
    const then = [
      r.addTags.length ? `tag ${r.addTags.join(", ")}` : "",
      r.assignTo ? `give it to ${memberName.get(r.assignTo) ?? "a teammate"}` : "",
      r.reply ? "reply automatically" : "",
      r.resolve ? "resolve it" : "",
    ].filter(Boolean);
    return `When ${when.join(" that ")}: ${then.join(", ")}.`;
  };
  const unused = d.templates.filter((t) => !d.rules.some((r) => r.name === t.name));
  return (
    <s-section heading="Automations">
      <s-stack gap="base">
        <s-paragraph>
          Each new comment or message runs through these in order. Tag it, give it to a teammate, answer it straight away, or resolve it, such as when someone says goodbye. Automated replies go once per conversation, and
          {" {name} "}becomes the person&apos;s first name.
        </s-paragraph>
        {d.rules.map((r) => (
          <div key={r.id} className="ib-rule">
            <label className="ib-switch">
              <input type="checkbox" checked={r.on} onChange={(e) => act.submit({ intent: "rule-toggle", ruleId: r.id, on: String(e.currentTarget.checked) }, { method: "post" })} />
              <span className="ib-sr">On</span>
            </label>
            <div>
              <strong>{r.name}</strong>
              <small>{describe(r)}</small>
            </div>
            <s-button variant="tertiary" onClick={() => setEditing({ ...r })}>
              Edit
            </s-button>
            <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "rule-delete", ruleId: r.id }, { method: "post" })}>
              Delete
            </s-button>
          </div>
        ))}
        {!editing && (
          <div className="ib-templates">
            <s-button onClick={() => setEditing(emptyRule())}>Add an automation</s-button>
            {unused.map((t) => (
              <button key={t.key} type="button" className="ib-tag" onClick={() => setEditing({ ...emptyRule(), ...t, id: "", assignTo: "" })}>
                + {t.name}
              </button>
            ))}
          </div>
        )}
        {editing && <RuleForm d={d} rule={editing} done={() => setEditing(null)} />}
      </s-stack>
    </s-section>
  );
}

function RuleForm({ d, rule, done }: { d: Data; rule: ReturnType<typeof emptyRule>; done: () => void }) {
  const save = useFetcher<typeof action>();
  const [r, setR] = useState({ ...rule, wordsText: rule.words.join(", "), tagsText: rule.addTags.join(", ") });
  const error = save.state === "idle" && save.data && "error" in save.data ? save.data.error : null;
  useEffect(() => {
    if (save.state === "idle" && save.data && "ok" in save.data) done();
  }, [save.state, save.data, done]);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const submit = () => {
    const fd = new FormData();
    fd.set("intent", "rule");
    fd.set("ruleId", r.id);
    fd.set("name", r.name);
    fd.set("on", String(r.on));
    for (const n of r.networks) fd.append("networks", n);
    for (const k of r.kinds) fd.append("kinds", k);
    fd.set("words", r.wordsText);
    fd.set("sentiment", r.sentiment);
    fd.set("addTags", r.tagsText);
    fd.set("assignTo", r.assignTo);
    fd.set("reply", r.reply);
    fd.set("resolve", String(r.resolve));
    save.submit(fd, { method: "post" });
  };
  return (
    <div className="ib-form">
      <s-text-field label="Name" value={r.name} placeholder="Order questions" onInput={(e) => setR({ ...r, name: e.currentTarget.value })} />
      <fieldset>
        <legend>When a new</legend>
        {(["comment", "message"] as Kind[]).map((k) => (
          <label key={k}>
            <input type="checkbox" checked={r.kinds.includes(k)} onChange={() => setR({ ...r, kinds: toggle(r.kinds, k) })} /> {k === "comment" ? "Comment" : "Direct message"}
          </label>
        ))}
        <span className="ib-hint">on</span>
        {d.networks.map((n) => (
          <label key={n}>
            <input type="checkbox" checked={r.networks.includes(n)} onChange={() => setR({ ...r, networks: toggle(r.networks, n) })} /> {NETWORK_NAME[n]}
          </label>
        ))}
        <span className="ib-hint">Leave a group unticked for all.</span>
      </fieldset>
      <s-text-field label="Says any of these words or phrases" details="Separate with commas. Leave empty to match everything." value={r.wordsText} placeholder="order, tracking, delivery" onInput={(e) => setR({ ...r, wordsText: e.currentTarget.value })} />
      <label className="ib-field">
        <span>And reads as</span>
        <select value={r.sentiment} onChange={(e) => setR({ ...r, sentiment: e.currentTarget.value })}>
          <option value="">Any feeling</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
        </select>
      </label>
      <fieldset>
        <legend>Then</legend>
      </fieldset>
      <s-text-field label="Add tags" details="Separate with commas." value={r.tagsText} placeholder="order status" onInput={(e) => setR({ ...r, tagsText: e.currentTarget.value })} />
      <label className="ib-field">
        <span>Give it to</span>
        <select value={r.assignTo} onChange={(e) => setR({ ...r, assignTo: e.currentTarget.value })}>
          <option value="">{d.members.length ? "No one in particular" : "Add teammates first"}</option>
          {d.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ib-field">
        <span>Reply automatically</span>
        <textarea rows={3} value={r.reply} placeholder="Hi {name}, thanks for getting in touch! Send us your order number and we'll check on it." onChange={(e) => setR({ ...r, reply: e.currentTarget.value })} />
      </label>
      <label>
        <input type="checkbox" checked={r.resolve} onChange={(e) => setR({ ...r, resolve: e.currentTarget.checked })} /> Resolve the conversation
      </label>
      {error && <s-banner tone="critical">{error}</s-banner>}
      <s-stack direction="inline" gap="small">
        <s-button variant="primary" loading={save.state !== "idle"} onClick={submit}>
          Save automation
        </s-button>
        <s-button onClick={done}>Cancel</s-button>
      </s-stack>
    </div>
  );
}

function Team({ d }: { d: Data }) {
  const [editing, setEditing] = useState<(Member & { skillsText: string }) | null>(null);
  const act = useFetcher<typeof action>();
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;
  const [seen, setSeen] = useState(act.data);
  if (act.state === "idle" && act.data !== seen) {
    setSeen(act.data);
    if (act.data && "ok" in act.data && act.data.intent === "member") setEditing(null);
  }
  return (
    <s-section heading="Team and routing">
      <s-stack gap="base">
        <s-paragraph>
          Add the people who answer your inbox, and the tags they&apos;re best at. New conversations go to a teammate whose skills match their tags, or else to someone who takes anything, whoever has the fewest open.
        </s-paragraph>
        {d.members.map((m) => (
          <div key={m.id} className="ib-rule">
            <label className="ib-switch">
              <input
                type="checkbox"
                checked={m.routing}
                onChange={(e) => act.submit({ intent: "member", memberId: m.id, name: m.name, skills: m.skills.join(", "), routing: String(e.currentTarget.checked) }, { method: "post" })}
              />
              <span className="ib-sr">Takes new conversations</span>
            </label>
            <div>
              <strong>{m.name}</strong>
              <small>
                {m.routing ? (m.skills.length ? `Takes ${m.skills.join(", ")}` : "Takes anything") : "Not taking new conversations"} · {d.counts.members[m.id] ?? 0} open
              </small>
            </div>
            <s-button variant="tertiary" onClick={() => setEditing({ ...m, skillsText: m.skills.join(", ") })}>
              Edit
            </s-button>
            <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "member-delete", memberId: m.id }, { method: "post" })}>
              Remove
            </s-button>
          </div>
        ))}
        {editing ? (
          <div className="ib-form">
            <s-text-field label="Name" value={editing.name} placeholder="Sam" onInput={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
            <s-text-field label="Skills" details="Tags they handle, separated by commas. Leave empty to take anything." value={editing.skillsText} placeholder="order status, returns" onInput={(e) => setEditing({ ...editing, skillsText: e.currentTarget.value })} />
            {d.tags.length > 0 && <small className="ib-hint">Tags in use: {d.tags.map((t) => t.tag).join(", ")}</small>}
            <label>
              <input type="checkbox" checked={editing.routing} onChange={(e) => setEditing({ ...editing, routing: e.currentTarget.checked })} /> Takes new conversations
            </label>
            {error && <s-banner tone="critical">{error}</s-banner>}
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                loading={act.state !== "idle"}
                onClick={() => act.submit({ intent: "member", memberId: editing.id, name: editing.name, skills: editing.skillsText, routing: String(editing.routing) }, { method: "post" })}
              >
                Save teammate
              </s-button>
              <s-button onClick={() => setEditing(null)}>Cancel</s-button>
            </s-stack>
          </div>
        ) : (
          <div>
            <s-button onClick={() => setEditing({ id: "", name: "", skills: [], routing: true, skillsText: "" })}>Add a teammate</s-button>
          </div>
        )}
      </s-stack>
    </s-section>
  );
}

const CSS = `
.ib-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
.ib-stat { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border: 1px solid #e3e3e3; border-radius: 12px; background: #fff; text-align: left; font: inherit; color: #303030; }
.ib-stat-btn { cursor: pointer; } .ib-stat-btn:hover { border-color: #c9c9c9; }
.ib-stat span { font-size: 12px; color: #616161; }
.ib-stat strong { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ib-stat small { font-size: 12px; color: #616161; display: flex; gap: 8px; flex-wrap: wrap; }
.ib-warn strong { color: #b54708; }
.ib-sentbar { display: flex; gap: 2px; height: 12px; margin: 10px 0 4px; }
.ib-sentbar i { display: block; min-width: 4px; border-radius: 4px; }
.ib-link { font: inherit; font-size: 12px; background: none; border: 0; padding: 0; color: #2a62d6; cursor: pointer; }
.ib-shell { display: grid; grid-template-columns: 190px minmax(260px, 340px) 1fr; border: 1px solid #e3e3e3; border-radius: 12px; background: #fff; height: 640px; overflow: hidden; margin-bottom: 8px; }
@media (max-width: 900px) { .ib-shell { grid-template-columns: 1fr; height: auto; } }
.ib-boxes { display: flex; flex-direction: column; gap: 2px; padding: 12px 8px; border-right: 1px solid #ececec; background: #fafafa; overflow-y: auto; }
.ib-boxes h3 { margin: 6px 8px 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #8a8a8a; }
.ib-boxes h3 + .ib-tagcloud { padding: 0 6px; }
.ib-box { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: 8px; background: none; font: inherit; font-size: 13px; color: #303030; cursor: pointer; text-align: left; }
.ib-box span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ib-box b { font-weight: 500; color: #616161; font-variant-numeric: tabular-nums; }
.ib-box:hover { background: #f0f0f0; } .ib-box.ib-on { background: #e8eefc; color: #1f3d99; font-weight: 600; }
.ib-tagcloud, .ib-templates { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ib-tag { font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 999px; border: 1px solid #d6d6f5; background: #f6f6fe; color: #3f3fa8; cursor: pointer; }
.ib-tag em { font-style: normal; color: #8a8ac0; }
.ib-list { display: flex; flex-direction: column; border-right: 1px solid #ececec; min-height: 0; }
.ib-search { padding: 10px 10px 6px; }
.ib-search input, .ib-tagsrow input { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid #d4d4d4; border-radius: 8px; }
.ib-filters, .ib-bulk { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 0 10px 8px; }
.ib-filters select, .ib-bulk select, .ib-convoacts select, .ib-composeacts select, .ib-field select { font: inherit; font-size: 12px; padding: 5px 6px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; }
.ib-bulk { font-size: 12px; color: #616161; padding-top: 6px; border-top: 1px solid #f1f1f1; }
.ib-bulk button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 8px; border: 1px solid #d4d4d4; background: #fff; cursor: pointer; }
.ib-items { overflow-y: auto; flex: 1; border-top: 1px solid #f1f1f1; }
.ib-empty { padding: 24px 16px; color: #8a8a8a; font-size: 13px; text-align: center; }
.ib-item { display: flex; align-items: flex-start; gap: 6px; padding: 10px 10px 10px 8px; border-bottom: 1px solid #f3f3f3; }
.ib-item > input { margin-top: 12px; }
.ib-item.ib-on { background: #f1f5fe; }
.ib-itembtn { display: flex; gap: 10px; flex: 1; min-width: 0; padding: 0; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; color: #303030; }
.ib-avatar { position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; background: #ece9fb; color: #4b3fb0; display: grid; place-items: center; font-size: 12px; font-weight: 600; }
.ib-avatar .ib-net { position: absolute; right: -3px; bottom: -3px; box-shadow: 0 0 0 2px #fff; }
.ib-net { display: inline-grid; place-items: center; flex: none; border-radius: 50%; vertical-align: -3px; }
.ib-itemtext { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.ib-itemtop { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.ib-itemtop strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ib-waiting .ib-itemtop strong::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #2a62d6; margin-right: 6px; vertical-align: 1px; }
.ib-itemtop time { flex: none; font-size: 11px; color: #8a8a8a; }
.ib-preview { font-size: 12.5px; color: #4a4a4a; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ib-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ib-chip { font-size: 11px; padding: 1px 7px; border-radius: 6px; background: #f1f1f1; color: #4a4a4a; }
.ib-chip-tag { background: #f6f6fe; color: #3f3fa8; } .ib-chip-who { background: #eef7f2; color: #0f6e45; } .ib-chip-done { background: #f1f1f1; color: #8a8a8a; }
.ib-dot { width: 8px; height: 8px; border-radius: 50%; }
.ib-convo { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.ib-convo-empty { display: grid; place-items: center; color: #8a8a8a; font-size: 13px; }
.ib-convohead { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px 16px; border-bottom: 1px solid #ececec; }
.ib-convohead > div:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ib-convohead small { font-size: 12px; color: #616161; }
.ib-convohead a { color: #2a62d6; }
.ib-convoacts { display: flex; gap: 8px; align-items: center; flex: none; }
.ib-post { margin: 10px 16px 0; padding: 8px 12px; border-left: 3px solid #d4d4d4; background: #fafafa; font-size: 12px; color: #616161; border-radius: 0 8px 8px 0; }
.ib-msgs { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.ib-msg { max-width: 75%; align-self: flex-start; }
.ib-msg p { margin: 0; padding: 9px 12px; border-radius: 14px 14px 14px 4px; background: #f1f1f1; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; color: #1f1f1f; }
.ib-msg small { display: block; margin-top: 3px; font-size: 11px; color: #8a8a8a; }
.ib-us { align-self: flex-end; text-align: right; }
.ib-us p { background: #2a62d6; color: #fff; border-radius: 14px 14px 4px 14px; text-align: left; }
.ib-tagsrow { display: flex; gap: 8px; align-items: center; padding: 8px 16px; border-top: 1px solid #f1f1f1; }
.ib-compose { display: flex; flex-direction: column; gap: 8px; padding: 10px 16px 14px; border-top: 1px solid #ececec; }
.ib-compose textarea, .ib-field textarea { font: inherit; font-size: 13.5px; padding: 9px 11px; border: 1px solid #d4d4d4; border-radius: 10px; resize: vertical; width: 100%; box-sizing: border-box; }
.ib-composeacts { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.ib-composeacts > s-button:first-child { margin-right: auto; }
.ib-count { font-size: 11px; color: #8a8a8a; font-variant-numeric: tabular-nums; }
.ib-rule { display: grid; grid-template-columns: auto 1fr auto auto; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid #e3e3e3; border-radius: 10px; }
.ib-rule > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ib-rule small { font-size: 12px; color: #616161; }
.ib-switch { position: relative; display: inline-block; }
.ib-switch input { appearance: none; width: 34px; height: 20px; border-radius: 999px; background: #c9c9c9; position: relative; cursor: pointer; margin: 0; transition: background .15s; }
.ib-switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
.ib-switch input:checked { background: #2a62d6; } .ib-switch input:checked::after { left: 16px; }
.ib-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.ib-form { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid #e3e3e3; border-radius: 12px; background: #fcfcfc; font-size: 13px; }
.ib-form fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.ib-form legend { font-weight: 600; margin-bottom: 6px; }
.ib-field { display: flex; flex-direction: column; gap: 4px; }
.ib-hint { color: #8a8a8a; font-size: 12px; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
