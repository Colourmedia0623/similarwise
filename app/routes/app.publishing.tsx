import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useFetchers, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { NETWORK_NAME, type Network } from "../lib/social/networks";
import type { TikTokChoices } from "../lib/social/networks.server";
import { checkTikTokPosts, tiktokAccount } from "../lib/social/social.server";
import {
  archiveCampaign,
  blogPlan,
  calendarData,
  deleteCampaign,
  deleteSocialPost,
  duplicatePost,
  movePost,
  readPostInput,
  retryPost,
  saveCampaign,
  savePost,
  sendNow,
  uploadSocialImage,
  writeSocialCaptions,
} from "../lib/social/publishing.server";
import { CAMPAIGN_COLORS, LIMITS } from "../lib/social/publishing";
import { addDays, dayLabel, timeLabel, validZone, weekStart, zoned } from "../lib/social/when";
import { TikTokPost } from "../components/TikTokPost";

// Social calendar: every post to the shop's Facebook Pages, Instagram and
// TikTok accounts on a week or month calendar, with a composer for posts
// written here (a picture and a caption, sent now, scheduled or kept as a
// draft), the queue, drafts, failed and sent posts, and campaigns.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const res = await admin
    .graphql(`{ shop { ianaTimezone } }`)
    .then((r) => r.json())
    .catch(() => null);
  const tz = validZone(res?.data?.shop?.ianaTimezone);
  await checkTikTokPosts(shop, null).catch((err) => console.error("Couldn't check TikTok posts", shop, err));
  const now = new Date();
  const today = zoned(now, tz).day;
  const [data, blog] = await Promise.all([calendarData(shop, now), blogPlan(shop, addDays(today, -120))]);
  return {
    ...data,
    blog,
    tz,
    today,
    now: now.toISOString(),
    ai: !!process.env.ANTHROPIC_API_KEY,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const text = (k: string) => String(form.get(k) ?? "");
  const id = text("id");
  if (intent === "save") return { intent, ...(await savePost(shop, readPostInput(form))) };
  if (intent === "upload") {
    const file = form.get("file");
    if (!(file instanceof File)) return { intent, error: "Choose a picture." };
    return { intent, ...(await uploadSocialImage(shop, file)) };
  }
  if (intent === "ai")
    return {
      intent,
      ...(await writeSocialCaptions(shop, text("brief"), text("draft"))),
    };
  if (intent === "tiktok") return { intent, ...(await tiktokAccount(shop, text("accountId"))) };
  if (intent === "move")
    return {
      intent,
      id,
      ...(await movePost(shop, id, text("day"), text("time"), text("tz"))),
    };
  if (intent === "duplicate") return { intent, ...(await duplicatePost(shop, id)) };
  if (intent === "delete") return { intent, id, ...(await deleteSocialPost(shop, id)) };
  if (intent === "retry") return { intent, id, ...(await retryPost(shop, id)) };
  if (intent === "send-now") return { intent, id, ...(await sendNow(shop, id)) };
  if (intent === "campaign") {
    return {
      intent,
      ...(await saveCampaign(shop, {
        id: id || undefined,
        name: text("name"),
        color: text("color"),
        startDay: text("startDay"),
        endDay: text("endDay"),
        note: text("note"),
      })),
    };
  }
  if (intent === "campaign-archive")
    return {
      intent,
      ...(await archiveCampaign(shop, id, text("archived") === "true")),
    };
  if (intent === "campaign-delete") return { intent, ...(await deleteCampaign(shop, id)) };
  return { intent, error: "Unknown action" };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Post = Data["posts"][number];
type Account = Data["accounts"][number];
type Campaign = Data["campaigns"][number];
type Share = Data["articleShares"][number];
type Answer = {
  intent?: string;
  error?: string;
  id?: string;
  status?: string;
  posted?: number;
  failed?: number;
  imageId?: string;
  url?: string;
  captions?: Record<string, string>;
};

type Section = "calendar" | "queue" | "drafts" | "failed" | "sent" | "campaigns";
type Mode = "week" | "month" | "list";

// What sits on a day of the calendar: a post from here, an article shared
// from its own page, or a blog article from the content calendar.
type Item =
  | {
      kind: "post";
      key: string;
      day: string;
      time: string;
      networks: Network[];
      post: Post;
    }
  | {
      kind: "share";
      key: string;
      day: string;
      time: string;
      networks: Network[];
      share: Share;
    }
  | {
      kind: "blog";
      key: string;
      day: string;
      time: string;
      networks: Network[];
      blog: Data["blog"][number];
    };

const NETWORKS: Network[] = ["facebook", "instagram", "tiktok", "pinterest"];
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending…",
  sent: "Posted",
  partial: "Partly posted",
  failed: "Didn't go out",
};

// --- Network marks -------------------------------------------------------

const NET_COLOR: Record<Network, string> = {
  facebook: "#1877f2",
  instagram: "#d6249f",
  tiktok: "#111111",
  pinterest: "#e60023",
};

function NetIcon({ n, size = 16 }: { n: Network; size?: number }) {
  return (
    <span className={`pc-net pc-net-${n}`} style={{ width: size, height: size }} title={NETWORK_NAME[n]} aria-label={NETWORK_NAME[n]}>
      <svg viewBox="0 0 16 16" width={size * 0.7} height={size * 0.7} aria-hidden="true">
        {n === "facebook" && (
          <path fill="#fff" d="M9.2 16V9h2.3l.4-2.7H9.2V4.6c0-.8.2-1.3 1.3-1.3H12V.9C11.7.8 10.9.8 10 .8 8 .8 6.6 2 6.6 4.2v2.1H4.3V9h2.3v7h2.6Z" />
        )}
        {n === "instagram" && (
          <g fill="none" stroke="#fff" strokeWidth="1.6">
            <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="3.6" />
            <circle cx="8" cy="8" r="3" />
            <circle cx="12" cy="4" r=".5" fill="#fff" stroke="none" />
          </g>
        )}
        {n === "tiktok" && (
          <path
            fill="#fff"
            d="M11.3 0c.3 2 1.4 3.2 3.4 3.3v2.4c-1.2.1-2.3-.3-3.4-1v4.4c0 5.6-6.1 7.3-8.5 3.3-1.6-2.6-.6-7 4.5-7.2v2.5c-.4.1-.8.2-1.1.3-1.2.4-1.8 1.1-1.6 2.3.4 2.3 4.6 3 4.2-1.5V0h2.5Z"
          />
        )}
        {n === "pinterest" && (
          <path
            fill="#fff"
            d="M8 .8a7.2 7.2 0 0 0-2.6 13.9c-.1-.6-.1-1.5 0-2.2l.9-3.6s-.2-.5-.2-1.1c0-1 .6-1.8 1.4-1.8.6 0 1 .5 1 1.1 0 .7-.4 1.7-.7 2.6-.2.8.4 1.4 1.2 1.4 1.4 0 2.5-1.5 2.5-3.7 0-1.9-1.4-3.3-3.4-3.3-2.3 0-3.7 1.7-3.7 3.6 0 .7.3 1.5.6 1.9.1.1.1.2 0 .3l-.2.8c0 .1-.1.2-.3.1-1-.5-1.6-1.9-1.6-3.1 0-2.5 1.8-4.8 5.3-4.8 2.8 0 4.9 2 4.9 4.6 0 2.8-1.7 5-4.1 5-.8 0-1.6-.4-1.8-.9l-.5 1.9c-.2.7-.7 1.6-1 2.1A7.2 7.2 0 1 0 8 .8Z"
          />
        )}
      </svg>
    </span>
  );
}

const Glyph = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
);
const G = {
  clock: "M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm1 2v3.6l2.7 2.7-1.4 1.4L9 10.4V6h2Z",
  draft: "M14.7 2.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L7.4 15.6 3 17l1.4-4.4L14.7 2.3Z",
  tick: "M8 13.6 3.7 9.3l1.4-1.4L8 10.8l6.9-6.9 1.4 1.4L8 13.6Z",
  alert: "M10 2 19 18H1L10 2Zm-1 6v4h2V8H9Zm0 5v2h2v-2H9Z",
  calendar: "M6 1h2v2h4V1h2v2h3v15H3V3h3V1Zm-1 6v9h10V7H5Z",
  queue: "M3 4h14v2H3V4Zm0 5h14v2H3V9Zm0 5h9v2H3v-2Z",
  flag: "M4 2h2v1h10l-2 4 2 4H6v7H4V2Z",
  send: "M2 3l16 7-16 7 2-7-2-7Zm3.6 6h5.4v2H5.6l-1 3.4L13.6 10 4.6 5.6l1 3.4Z",
  plus: "M9 3h2v6h6v2h-6v6H9v-6H3V9h6V3Z",
  blog: "M4 2h9l3 3v13H4V2Zm2 5v2h8V7H6Zm0 4v2h8v-2H6Z",
};

// --- The page -------------------------------------------------------------

export default function Publishing() {
  const data = useLoaderData<typeof loader>();
  const { accounts, posts, campaigns, tz, today } = data;
  const [section, setSection] = useState<Section>("calendar");
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(today);
  const [nets, setNets] = useState<Network[]>(NETWORKS);
  const [campaignFilter, setCampaignFilter] = useState("");
  const [showBlog, setShowBlog] = useState(true);
  const [composer, setComposer] = useState<{
    post?: Post;
    day?: string;
    time?: string;
  } | null>(null);
  const [detail, setDetail] = useState<{ post?: Post; share?: Share } | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);
  const dup = useFetcher<Answer>();

  // A duplicated post opens in the composer once it's there.
  const dupId = dup.state === "idle" && dup.data?.id ? dup.data.id : null;
  const [openedDup, setOpenedDup] = useState<string | null>(null);
  const dupPost = dupId && dupId !== openedDup ? posts.find((x) => x.id === dupId) : undefined;
  if (dupPost) {
    setOpenedDup(dupPost.id);
    setDetail(null);
    setComposer({ post: dupPost });
  }

  // Moves still on their way to the server show where they're going.
  const fetchers = useFetchers();
  const moving = new Map<string, string>();
  for (const f of fetchers) if (f.formData?.get("intent") === "move") moving.set(String(f.formData.get("id")), String(f.formData.get("day")));

  const campaignById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const postNetworks = (p: Post) => [...new Set(p.accountIds.map((id) => accountById.get(id)?.network).filter((n): n is Network => !!n))];

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const p of posts) {
      if (!p.at) continue;
      const when = zoned(new Date(p.at), tz);
      out.push({
        kind: "post",
        key: p.id,
        day: moving.get(p.id) ?? when.day,
        time: when.time,
        networks: postNetworks(p),
        post: p,
      });
    }
    for (const s of data.articleShares) {
      const when = zoned(new Date(s.at), tz);
      out.push({
        kind: "share",
        key: s.id,
        day: when.day,
        time: when.time,
        networks: [...new Set(s.results.map((r) => r.network))],
        share: s,
      });
    }
    if (showBlog)
      for (const b of data.blog)
        out.push({
          kind: "blog",
          key: b.id,
          day: b.day,
          time: "",
          networks: [],
          blog: b,
        });
    return out
      .filter((i) => i.kind === "blog" || i.networks.length === 0 || i.networks.some((n) => nets.includes(n)))
      .filter((i) => !campaignFilter || (i.kind === "post" && i.post.campaignId === campaignFilter))
      .sort((a, b) => (a.day + (a.time || "99")).localeCompare(b.day + (b.time || "99")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, data.articleShares, data.blog, showBlog, nets, campaignFilter, tz, fetchers]);

  const counts = {
    queue: posts.filter((p) => p.status === "scheduled").length,
    drafts: posts.filter((p) => p.status === "draft").length,
    failed: posts.filter((p) => p.status === "failed" || p.status === "partial").length,
  };

  const open = (item: Item) => {
    if (item.kind === "blog") return;
    if (item.kind === "share") return setDetail({ share: item.share });
    if (["draft", "scheduled", "failed"].includes(item.post.status)) return setComposer({ post: item.post });
    setDetail({ post: item.post });
  };
  const newPost = (day?: string) => {
    // A new post on a day defaults to the next round hour, or 9 am.
    const nowTime = zoned(new Date(), tz).time;
    const nextHour = `${String(Math.min(23, Number(nowTime.slice(0, 2)) + 1)).padStart(2, "0")}:00`;
    setComposer({
      day: day ?? today,
      time: (day ?? today) === today ? nextHour : "09:00",
    });
  };

  const rail: { key: Section; label: string; icon: string; count?: number }[] = [
    { key: "calendar", label: "Calendar", icon: G.calendar },
    { key: "queue", label: "Queue", icon: G.queue, count: counts.queue },
    { key: "drafts", label: "Drafts", icon: G.draft, count: counts.drafts },
    {
      key: "failed",
      label: "Failed posts",
      icon: G.alert,
      count: counts.failed,
    },
    { key: "sent", label: "Sent", icon: G.tick },
    {
      key: "campaigns",
      label: "Campaigns",
      icon: G.flag,
      count: campaigns.filter((c) => !c.archived).length,
    },
  ];

  return (
    <s-page heading="Social calendar" inlineSize="large">
      <s-button slot="primary-action" variant="primary" onClick={() => newPost()}>
        New post
      </s-button>
      {accounts.length === 0 && (
        <s-banner tone="info">
          Connect your Facebook Page, Instagram or TikTok under <s-link href="/app/social">Social accounts</s-link> to start posting from here.
        </s-banner>
      )}
      {notice && (
        <s-banner tone={notice.tone} dismissible onDismiss={() => setNotice(null)}>
          {notice.text}
        </s-banner>
      )}
      <div className="pc-shell">
        <nav className="pc-rail" aria-label="Social calendar sections">
          <button type="button" className="pc-rail-new" onClick={() => newPost()}>
            <Glyph d={G.plus} /> New post
          </button>
          {rail.map((r) => (
            <button key={r.key} type="button" className={`pc-rail-item${section === r.key ? " pc-rail-on" : ""}`} onClick={() => setSection(r.key)}>
              <Glyph d={r.icon} />
              <span>{r.label}</span>
              {!!r.count && <em className={r.key === "failed" ? "pc-count-bad" : ""}>{r.count}</em>}
            </button>
          ))}
          <div className="pc-rail-foot">
            Times are in {tz.replace(/_/g, " ")}. <Link to="/app/social">Social accounts</Link>
          </div>
        </nav>
        <div className="pc-main">
          {section === "calendar" && (
            <>
              <Toolbar
                mode={mode}
                setMode={setMode}
                anchor={anchor}
                setAnchor={setAnchor}
                today={today}
                nets={nets}
                setNets={setNets}
                campaigns={campaigns}
                campaignFilter={campaignFilter}
                setCampaignFilter={setCampaignFilter}
                showBlog={showBlog}
                setShowBlog={setShowBlog}
              />
              {mode === "week" && (
                <WeekView anchor={anchor} today={today} items={items} campaigns={campaigns} campaignById={campaignById} tz={tz} onOpen={open} onNew={newPost} />
              )}
              {mode === "month" && (
                <MonthView
                  anchor={anchor}
                  today={today}
                  items={items}
                  campaignById={campaignById}
                  tz={tz}
                  onOpen={open}
                  onNew={newPost}
                  onWeek={(day) => {
                    setAnchor(day);
                    setMode("week");
                  }}
                />
              )}
              {mode === "list" && <ListView anchor={anchor} today={today} items={items} campaignById={campaignById} onOpen={open} />}
            </>
          )}
          {section === "queue" && (
            <PostList
              title="Queue"
              intro="Scheduled posts, in the order they go out."
              empty="Nothing scheduled. Press New post to schedule one."
              posts={posts.filter((p) => p.status === "scheduled")}
              {...{ tz, accountById, campaignById }}
              onEdit={(p) => setComposer({ post: p })}
              onDuplicate={(p) => dup.submit({ intent: "duplicate", id: p.id }, { method: "post" })}
            />
          )}
          {section === "drafts" && (
            <PostList
              title="Drafts"
              intro="Posts you've started but haven't scheduled."
              empty="No drafts."
              posts={[...posts.filter((p) => p.status === "draft")].reverse()}
              {...{ tz, accountById, campaignById }}
              onEdit={(p) => setComposer({ post: p })}
              onDuplicate={(p) => dup.submit({ intent: "duplicate", id: p.id }, { method: "post" })}
            />
          )}
          {section === "failed" && (
            <PostList
              title="Failed posts"
              intro="Posts a network didn't take. Fix what it says, then retry the accounts that failed."
              empty="Nothing has failed."
              posts={[...posts.filter((p) => p.status === "failed" || p.status === "partial")].reverse()}
              {...{ tz, accountById, campaignById }}
              onEdit={(p) => setComposer({ post: p })}
              onDuplicate={(p) => dup.submit({ intent: "duplicate", id: p.id }, { method: "post" })}
            />
          )}
          {section === "sent" && (
            <SentList
              posts={posts.filter((p) => p.status === "sent" || p.status === "partial")}
              shares={data.articleShares}
              tz={tz}
              campaignById={campaignById}
              onOpen={setDetail}
            />
          )}
          {section === "campaigns" && (
            <Campaigns
              campaigns={campaigns}
              posts={posts}
              onShow={(c) => {
                setCampaignFilter(c.id);
                if (c.startDay) setAnchor(c.startDay);
                setSection("calendar");
              }}
            />
          )}
        </div>
      </div>

      {composer && (
        <Composer
          key={composer.post?.id ?? "new"}
          post={composer.post}
          day={composer.day}
          time={composer.time}
          data={data}
          onClose={() => setComposer(null)}
          onDone={(text) => {
            setComposer(null);
            setNotice({ tone: "success", text });
          }}
        />
      )}
      {detail && (
        <Detail
          post={detail.post}
          share={detail.share}
          tz={tz}
          campaignById={campaignById}
          onClose={() => setDetail(null)}
          onDuplicate={(p) => dup.submit({ intent: "duplicate", id: p.id }, { method: "post" })}
        />
      )}
      <style>{CSS}</style>
    </s-page>
  );
}

// --- Toolbar ---------------------------------------------------------------

function Toolbar(props: {
  mode: Mode;
  setMode: (m: Mode) => void;
  anchor: string;
  setAnchor: (d: string) => void;
  today: string;
  nets: Network[];
  setNets: (n: Network[]) => void;
  campaigns: Campaign[];
  campaignFilter: string;
  setCampaignFilter: (id: string) => void;
  showBlog: boolean;
  setShowBlog: (b: boolean) => void;
}) {
  const { mode, anchor, setAnchor } = props;
  const step = (n: number) => {
    if (mode === "month") {
      const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + n);
      setAnchor(d.toISOString().slice(0, 10));
    } else setAnchor(addDays(anchor, n * (mode === "week" ? 7 : 30)));
  };
  const start = weekStart(anchor);
  const label =
    mode === "month"
      ? dayLabel(anchor, { month: "long", year: "numeric" })
      : mode === "week"
        ? `${dayLabel(start, { day: "numeric", month: "short" })} – ${dayLabel(addDays(start, 6), { day: "numeric", month: "short", year: "numeric" })}`
        : `${dayLabel(anchor, { day: "numeric", month: "short" })} – ${dayLabel(addDays(anchor, 29), { day: "numeric", month: "short", year: "numeric" })}`;
  const toggle = (n: Network) => props.setNets(props.nets.includes(n) ? props.nets.filter((x) => x !== n) : [...props.nets, n]);
  return (
    <div className="pc-toolbar">
      <div className="pc-nav">
        <button type="button" className="pc-btn pc-btn-icon" onClick={() => step(-1)} aria-label="Earlier">
          ‹
        </button>
        <button type="button" className="pc-btn" onClick={() => setAnchor(props.today)}>
          Today
        </button>
        <button type="button" className="pc-btn pc-btn-icon" onClick={() => step(1)} aria-label="Later">
          ›
        </button>
        <strong className="pc-range">{label}</strong>
      </div>
      <div className="pc-filters">
        <div className="pc-netfilter" role="group" aria-label="Networks">
          {NETWORKS.map((n) => (
            <button
              key={n}
              type="button"
              className={`pc-chip${props.nets.includes(n) ? " pc-chip-on" : ""}`}
              aria-pressed={props.nets.includes(n)}
              onClick={() => toggle(n)}
            >
              <NetIcon n={n} size={16} />
              {NETWORK_NAME[n]}
            </button>
          ))}
          <button
            type="button"
            className={`pc-chip${props.showBlog ? " pc-chip-on" : ""}`}
            aria-pressed={props.showBlog}
            onClick={() => props.setShowBlog(!props.showBlog)}
          >
            <Glyph d={G.blog} /> Blog
          </button>
        </div>
        {props.campaigns.length > 0 && (
          <select className="pc-select" value={props.campaignFilter} onChange={(e) => props.setCampaignFilter(e.currentTarget.value)} aria-label="Campaign">
            <option value="">All campaigns</option>
            {props.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <div className="pc-seg" role="group" aria-label="View">
          {(["list", "week", "month"] as Mode[]).map((m) => (
            <button key={m} type="button" className={mode === m ? "pc-seg-on" : ""} onClick={() => props.setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Week -------------------------------------------------------------------

function WeekView({
  anchor,
  today,
  items,
  campaigns,
  campaignById,
  tz,
  onOpen,
  onNew,
}: {
  anchor: string;
  today: string;
  items: Item[];
  campaigns: Campaign[];
  campaignById: Map<string, Campaign>;
  tz: string;
  onOpen: (i: Item) => void;
  onNew: (day: string) => void;
}) {
  const start = weekStart(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = days[6];
  const bars = campaigns
    .filter((c) => !c.archived && c.startDay && c.endDay && c.startDay <= end && c.endDay >= start)
    .map((c) => ({
      c,
      from: Math.max(0, days.indexOf(c.startDay! < start ? start : c.startDay!)),
      to: days.indexOf(c.endDay! > end ? end : c.endDay!),
    }));
  const [over, setOver] = useState<string | null>(null);
  const mover = useFetcher<Answer>();
  const moveError = mover.state === "idle" && mover.data?.error;

  return (
    <div className="pc-week-wrap">
      {moveError && <s-banner tone="warning">{moveError}</s-banner>}
      <div className="pc-week">
        {days.map((d) => (
          <div key={d} className={`pc-week-head${d === today ? " pc-today" : ""}`}>
            <span>{dayLabel(d, { weekday: "short" })}</span>
            <strong>{dayLabel(d, { day: "numeric" })}</strong>
          </div>
        ))}
        {bars.length > 0 && (
          <div className="pc-bars">
            {bars.map(({ c, from, to }) => (
              <div
                key={c.id}
                className="pc-bar"
                style={{
                  gridColumn: `${from + 1} / ${to + 2}`,
                  ["--c" as string]: c.color,
                }}
                title={c.note ?? c.name}
              >
                <strong>{c.name}</strong>
                {c.note && <span>{c.note}</span>}
                <em>
                  {dayLabel(c.startDay!, { day: "numeric", month: "short" })} – {dayLabel(c.endDay!, { day: "numeric", month: "short" })}
                </em>
              </div>
            ))}
          </div>
        )}
        {days.map((d, i) => {
          const dayItems = items.filter((i) => i.day === d);
          return (
            <div
              key={d}
              className={`pc-week-col${d < today ? " pc-past" : ""}${over === d ? " pc-drop" : ""}${i === 6 ? " pc-last" : ""}`}
              onDragOver={(e) => {
                if (d < today) return;
                e.preventDefault();
                setOver(d);
              }}
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const [id, time] = e.dataTransfer.getData("text/plain").split("|");
                if (id && d >= today) mover.submit({ intent: "move", id, day: d, time, tz }, { method: "post" });
              }}
            >
              {dayItems.map((i) => (
                <Card
                  key={i.key}
                  item={i}
                  campaign={i.kind === "post" && i.post.campaignId ? campaignById.get(i.post.campaignId) : undefined}
                  onOpen={onOpen}
                />
              ))}
              {d >= today && (
                <button type="button" className="pc-add" onClick={() => onNew(d)}>
                  <Glyph d={G.plus} size={12} /> Add post
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="pc-legend">
      <span>
        <i className="pc-dot pc-dot-scheduled" />
        Scheduled
      </span>
      <span>
        <i className="pc-dot pc-dot-draft" />
        Draft
      </span>
      <span>
        <i className="pc-dot pc-dot-sent" />
        Posted
      </span>
      <span>
        <i className="pc-dot pc-dot-failed" />
        Didn&apos;t go out
      </span>
      <span>
        <i className="pc-dot pc-dot-blog" />
        Blog article
      </span>
      <span className="pc-legend-tip">Drag a scheduled post or draft to another day to move it.</span>
    </div>
  );
}

const itemStatus = (i: Item) =>
  i.kind === "post" ? i.post.status : i.kind === "share" ? (i.share.results.every((r) => r.status === "failed") ? "failed" : "sent") : "blog";

// A post on the calendar: its networks, time, caption, picture and campaign.
function Card({ item, campaign, onOpen }: { item: Item; campaign?: Campaign; onOpen: (i: Item) => void }) {
  const status = itemStatus(item);
  if (item.kind === "blog") {
    return (
      <Link to="/app/calendar" className="pc-card pc-card-blog">
        <span className="pc-card-top">
          <span className="pc-blog-tag">
            <Glyph d={G.blog} size={12} /> Blog
          </span>
        </span>
        <span className="pc-card-text">{item.blog.title}</span>
      </Link>
    );
  }
  const caption = item.kind === "post" ? item.post.caption || Object.values(item.post.captions)[0] || "" : item.share.title;
  const image = item.kind === "post" ? item.post.image : item.share.image;
  const draggable = item.kind === "post" && (status === "draft" || status === "scheduled");
  return (
    <button
      type="button"
      className={`pc-card pc-card-${status}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", `${item.key}|${item.time}`);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(item)}
    >
      <span className="pc-card-top">
        <span className="pc-card-nets">
          {item.networks.map((n) => (
            <NetIcon key={n} n={n} size={16} />
          ))}
        </span>
        <span className={`pc-card-time pc-time-${status}`}>
          <Glyph d={status === "draft" ? G.draft : status === "sent" ? G.tick : status === "failed" || status === "partial" ? G.alert : G.clock} size={11} />
          {timeLabel(item.time)}
        </span>
      </span>
      <span className="pc-card-body">
        <span className="pc-card-text">{caption || <i>No caption yet</i>}</span>
        {image && <img src={image} alt="" loading="lazy" />}
      </span>
      {(campaign || item.kind === "share" || status === "failed" || status === "partial") && (
        <span className="pc-card-foot">
          {campaign && (
            <span className="pc-tag" style={{ ["--c" as string]: campaign.color }}>
              {campaign.name}
            </span>
          )}
          {item.kind === "share" && <span className="pc-tag pc-tag-plain">Blog article share</span>}
          {(status === "failed" || status === "partial") && <span className="pc-tag pc-tag-bad">{STATUS_LABEL[status]}</span>}
        </span>
      )}
    </button>
  );
}

// --- Month ------------------------------------------------------------------

function MonthView({
  anchor,
  today,
  items,
  campaignById,
  onOpen,
  onNew,
  onWeek,
}: {
  anchor: string;
  today: string;
  items: Item[];
  campaignById: Map<string, Campaign>;
  tz: string;
  onOpen: (i: Item) => void;
  onNew: (day: string) => void;
  onWeek: (day: string) => void;
}) {
  const month = anchor.slice(0, 7);
  const first = `${month}-01`;
  const start = weekStart(first);
  const daysIn = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const weeks = Math.ceil((((new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7) + daysIn) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const SHOW = 3;
  return (
    <div>
      <div className="pc-month">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="pc-month-head">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const dayItems = items.filter((i) => i.day === d);
          const inMonth = d.startsWith(month);
          return (
            <div key={d} className={`pc-month-cell${inMonth ? "" : " pc-out"}${d < today ? " pc-past" : ""}`}>
              <div className="pc-month-date">
                <span className={d === today ? "pc-today-dot" : ""}>{Number(d.slice(8))}</span>
                {d >= today && (
                  <button
                    type="button"
                    className="pc-month-add"
                    onClick={() => onNew(d)}
                    aria-label={`New post on ${dayLabel(d, { day: "numeric", month: "long" })}`}
                  >
                    <Glyph d={G.plus} size={11} />
                  </button>
                )}
              </div>
              {dayItems.slice(0, SHOW).map((i) => {
                const status = itemStatus(i);
                const campaign = i.kind === "post" && i.post.campaignId ? campaignById.get(i.post.campaignId) : undefined;
                const text =
                  i.kind === "post" ? i.post.caption || Object.values(i.post.captions)[0] || "Draft" : i.kind === "share" ? i.share.title : i.blog.title;
                return i.kind === "blog" ? (
                  <Link key={i.key} to="/app/calendar" className="pc-pill pc-pill-blog">
                    <Glyph d={G.blog} size={11} />
                    <span>{text}</span>
                  </Link>
                ) : (
                  <button
                    key={i.key}
                    type="button"
                    className={`pc-pill pc-pill-${status}`}
                    style={campaign ? { ["--c" as string]: campaign.color } : undefined}
                    onClick={() => onOpen(i)}
                  >
                    <span className="pc-pill-nets">
                      {i.networks.map((n) => (
                        <NetIcon key={n} n={n} size={13} />
                      ))}
                    </span>
                    <b>{timeLabel(i.time).replace(":00", "")}</b>
                    <span>{text}</span>
                  </button>
                );
              })}
              {dayItems.length > SHOW && (
                <button type="button" className="pc-more" onClick={() => onWeek(d)}>
                  +{dayItems.length - SHOW} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

// --- List -------------------------------------------------------------------

function ListView({
  anchor,
  today,
  items,
  campaignById,
  onOpen,
}: {
  anchor: string;
  today: string;
  items: Item[];
  campaignById: Map<string, Campaign>;
  onOpen: (i: Item) => void;
}) {
  const end = addDays(anchor, 29);
  const inRange = items.filter((i) => i.day >= anchor && i.day <= end);
  const days = [...new Set(inRange.map((i) => i.day))];
  if (!days.length) return <div className="pc-empty">Nothing on the calendar for these 30 days.</div>;
  return (
    <div className="pc-list">
      {days.map((d) => (
        <section key={d} className="pc-list-day">
          <h3 className={d === today ? "pc-list-today" : ""}>
            {d === today ? "Today, " : ""}
            {dayLabel(d, { weekday: "long", day: "numeric", month: "long" })}
          </h3>
          <div className="pc-list-cards">
            {inRange
              .filter((i) => i.day === d)
              .map((i) => (
                <Card
                  key={i.key}
                  item={i}
                  campaign={i.kind === "post" && i.post.campaignId ? campaignById.get(i.post.campaignId) : undefined}
                  onOpen={onOpen}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// --- Queue, drafts and failed posts ----------------------------------------

function PostList({
  title,
  intro,
  empty,
  posts,
  tz,
  accountById,
  campaignById,
  onEdit,
  onDuplicate,
}: {
  title: string;
  intro: string;
  empty: string;
  posts: Post[];
  tz: string;
  accountById: Map<string, Account>;
  campaignById: Map<string, Campaign>;
  onEdit: (p: Post) => void;
  onDuplicate: (p: Post) => void;
}) {
  const heads = new Set<string>();
  const firstOfDay = new Set(
    posts.flatMap((p) => {
      const day = p.at ? zoned(new Date(p.at), tz).day : null;
      if (!day || heads.has(day)) return [];
      heads.add(day);
      return [p.id];
    }),
  );
  return (
    <div className="pc-panel">
      <h2>{title}</h2>
      <p className="pc-muted">{intro}</p>
      {posts.length === 0 && <div className="pc-empty">{empty}</div>}
      {posts.map((p) => {
        const when = p.at ? zoned(new Date(p.at), tz) : null;
        const head = when && firstOfDay.has(p.id) ? when.day : null;
        return (
          <div key={p.id}>
            {head && title === "Queue" && (
              <h3 className="pc-list-head">
                {dayLabel(head, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </h3>
            )}
            <PostRow
              p={p}
              when={when}
              accountById={accountById}
              campaign={p.campaignId ? campaignById.get(p.campaignId) : undefined}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
            />
          </div>
        );
      })}
    </div>
  );
}

function PostRow({
  p,
  when,
  accountById,
  campaign,
  onEdit,
  onDuplicate,
}: {
  p: Post;
  when: { day: string; time: string } | null;
  accountById: Map<string, Account>;
  campaign?: Campaign;
  onEdit: (p: Post) => void;
  onDuplicate: (p: Post) => void;
}) {
  const act = useFetcher<Answer>();
  const busy = (i: string) => act.state !== "idle" && act.formData?.get("intent") === i;
  const error = act.state === "idle" ? act.data?.error : null;
  if (busy("delete")) return null;
  return (
    <div className={`pc-row pc-row-${p.status}`}>
      <div className="pc-row-when">
        {when ? (
          <>
            <strong>{timeLabel(when.time)}</strong>
            <span>
              {dayLabel(when.day, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </span>
          </>
        ) : (
          <span>No time set</span>
        )}
      </div>
      {p.image ? <img className="pc-row-img" src={p.image} alt="" /> : <div className="pc-row-img pc-row-noimg" />}
      <div className="pc-row-main">
        <div className="pc-row-accounts">
          {p.accountIds.map((id) => {
            const a = accountById.get(id);
            return a ? (
              <span key={id} className="pc-acct">
                <NetIcon n={a.network} size={14} />
                {a.name}
              </span>
            ) : null;
          })}
          {campaign && (
            <span className="pc-tag" style={{ ["--c" as string]: campaign.color }}>
              {campaign.name}
            </span>
          )}
        </div>
        <p className="pc-row-text">{p.caption || Object.values(p.captions)[0] || <i>No caption yet</i>}</p>
        {(p.status === "failed" || p.status === "partial") &&
          p.results
            .filter((r) => r.status === "failed")
            .map((r) => (
              <p key={r.id} className="pc-row-error">
                <NetIcon n={r.network} size={13} /> {r.account}: {r.error}
              </p>
            ))}
        {error && <p className="pc-row-error">{error}</p>}
        <div className="pc-row-actions">
          {(p.status === "draft" || p.status === "scheduled" || p.status === "failed") && (
            <button type="button" className="pc-btn" onClick={() => onEdit(p)}>
              Edit
            </button>
          )}
          {p.status === "scheduled" && (
            <button
              type="button"
              className="pc-btn"
              disabled={busy("send-now")}
              onClick={() => act.submit({ intent: "send-now", id: p.id }, { method: "post" })}
            >
              {busy("send-now") ? "Posting…" : "Post now"}
            </button>
          )}
          {(p.status === "failed" || p.status === "partial") && (
            <button
              type="button"
              className="pc-btn pc-btn-primary"
              disabled={busy("retry")}
              onClick={() => act.submit({ intent: "retry", id: p.id }, { method: "post" })}
            >
              {busy("retry") ? "Retrying…" : "Retry failed accounts"}
            </button>
          )}
          <button type="button" className="pc-btn" onClick={() => onDuplicate(p)}>
            Duplicate
          </button>
          <button
            type="button"
            className="pc-btn pc-btn-danger"
            onClick={() => {
              if (confirm(p.status === "partial" ? "Take this post off the calendar? What already went out stays on the networks." : "Delete this post?"))
                act.submit({ intent: "delete", id: p.id }, { method: "post" });
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Sent -------------------------------------------------------------------

function SentList({
  posts,
  shares,
  tz,
  campaignById,
  onOpen,
}: {
  posts: Post[];
  shares: Share[];
  tz: string;
  campaignById: Map<string, Campaign>;
  onOpen: (d: { post?: Post; share?: Share }) => void;
}) {
  const rows = [
    ...posts.map((p) => ({
      key: p.id,
      at: p.sentAt ?? p.at ?? p.updatedAt,
      text: p.caption || Object.values(p.captions)[0] || "",
      image: p.image,
      results: p.results,
      open: () => onOpen({ post: p }),
      campaign: p.campaignId ? campaignById.get(p.campaignId) : undefined,
      from: "",
    })),
    ...shares.map((s) => ({
      key: s.id,
      at: s.at,
      text: s.title,
      image: s.image,
      results: s.results,
      open: () => onOpen({ share: s }),
      campaign: undefined,
      from: "Blog article share",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="pc-panel">
      <h2>Sent</h2>
      <p className="pc-muted">Everything that went out in the last four months, from here and from your blog articles.</p>
      {rows.length === 0 && <div className="pc-empty">Nothing sent yet.</div>}
      {rows.map((r) => {
        const when = zoned(new Date(r.at), tz);
        return (
          <button key={r.key} type="button" className="pc-row pc-row-sent pc-row-button" onClick={r.open}>
            <div className="pc-row-when">
              <strong>{timeLabel(when.time)}</strong>
              <span>
                {dayLabel(when.day, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </div>
            {r.image ? <img className="pc-row-img" src={r.image} alt="" /> : <div className="pc-row-img pc-row-noimg" />}
            <div className="pc-row-main">
              <div className="pc-row-accounts">
                {r.results.map((x) => (
                  <span key={x.id} className={`pc-acct${x.status === "failed" ? " pc-acct-bad" : ""}`}>
                    <NetIcon n={x.network} size={14} />
                    {x.account}
                    {x.status === "processing" ? " (processing)" : x.status === "failed" ? " (failed)" : ""}
                  </span>
                ))}
                {r.campaign && (
                  <span className="pc-tag" style={{ ["--c" as string]: r.campaign.color }}>
                    {r.campaign.name}
                  </span>
                )}
                {r.from && <span className="pc-tag pc-tag-plain">{r.from}</span>}
              </div>
              <p className="pc-row-text">{r.text}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// A post that went out: where it went, links to each, and what to do next.
function Detail({
  post,
  share,
  tz,
  campaignById,
  onClose,
  onDuplicate,
}: {
  post?: Post;
  share?: Share;
  tz: string;
  campaignById: Map<string, Campaign>;
  onClose: () => void;
  onDuplicate: (p: Post) => void;
}) {
  const act = useFetcher<Answer>();
  const results = post?.results ?? share?.results ?? [];
  const at = post?.sentAt ?? post?.at ?? share?.at;
  const when = at ? zoned(new Date(at), tz) : null;
  const campaign = post?.campaignId ? campaignById.get(post.campaignId) : undefined;
  const deleted = act.state === "idle" && act.data?.intent === "delete" && !act.data.error;
  useEffect(() => {
    if (deleted) onClose();
  }, [deleted, onClose]);
  return (
    <div className="pc-overlay" role="dialog" aria-modal="true" aria-label="Post">
      <div className="pc-drawer">
        <header className="pc-drawer-head">
          <h2>{share ? "Blog article share" : STATUS_LABEL[post!.status]}</h2>
          <button type="button" className="pc-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pc-drawer-body">
          {when && (
            <p className="pc-muted">
              {dayLabel(when.day, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}{" "}
              at {timeLabel(when.time)}
            </p>
          )}
          {campaign && (
            <span className="pc-tag" style={{ ["--c" as string]: campaign.color }}>
              {campaign.name}
            </span>
          )}
          {(post?.image || share?.image) && <img className="pc-detail-img" src={(post?.image ?? share?.image)!} alt="" />}
          <p className="pc-detail-text">{post ? post.caption || Object.values(post.captions)[0] : share!.caption}</p>
          {post?.link && (
            <p className="pc-muted">
              Link:{" "}
              <a href={post.link} target="_blank" rel="noreferrer">
                {post.link}
              </a>
            </p>
          )}
          <h3>Where it went</h3>
          <ul className="pc-results">
            {results.map((r) => (
              <li key={r.id}>
                <NetIcon n={r.network} size={18} />
                <span>
                  <strong>{r.account}</strong>
                  {r.status === "failed" ? (
                    <em className="pc-bad">{r.error}</em>
                  ) : r.status === "processing" ? (
                    <em>TikTok is still processing it.</em>
                  ) : (
                    <em>Posted</em>
                  )}
                </span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    View
                  </a>
                )}
              </li>
            ))}
          </ul>
          {share && (
            <p className="pc-muted">
              Shared from <Link to={`/app/articles/${share.articleId}`}>{share.title}</Link>.
            </p>
          )}
        </div>
        {post && (
          <footer className="pc-drawer-foot">
            {post.status === "partial" && (
              <button
                type="button"
                className="pc-btn pc-btn-primary"
                disabled={act.state !== "idle"}
                onClick={() => act.submit({ intent: "retry", id: post.id }, { method: "post" })}
              >
                Retry failed accounts
              </button>
            )}
            <button type="button" className="pc-btn" onClick={() => onDuplicate(post)}>
              Duplicate
            </button>
            <button
              type="button"
              className="pc-btn pc-btn-danger"
              onClick={() =>
                confirm("Take this post off the calendar? It stays on the networks.") && act.submit({ intent: "delete", id: post.id }, { method: "post" })
              }
            >
              Remove from calendar
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

// --- Campaigns --------------------------------------------------------------

function Campaigns({ campaigns, posts, onShow }: { campaigns: Campaign[]; posts: Post[]; onShow: (c: Campaign) => void }) {
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const active = campaigns.filter((c) => !c.archived);
  const archived = campaigns.filter((c) => c.archived);
  return (
    <div className="pc-panel">
      <div className="pc-panel-head">
        <div>
          <h2>Campaigns</h2>
          <p className="pc-muted">Group posts for a launch, a sale or a season. Each campaign gets a colour on the calendar and a bar across its dates.</p>
        </div>
        <button type="button" className="pc-btn pc-btn-primary" onClick={() => setEditing("new")}>
          New campaign
        </button>
      </div>
      {editing && (
        <CampaignForm key={editing === "new" ? "new" : editing.id} campaign={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
      )}
      {active.length === 0 && !editing && <div className="pc-empty">No campaigns yet.</div>}
      {active.map((c) => (
        <CampaignRow key={c.id} c={c} posts={posts} onShow={onShow} onEdit={() => setEditing(c)} />
      ))}
      {archived.length > 0 && (
        <details className="pc-archived">
          <summary>Archived campaigns ({archived.length})</summary>
          {archived.map((c) => (
            <CampaignRow key={c.id} c={c} posts={posts} onShow={onShow} onEdit={() => setEditing(c)} />
          ))}
        </details>
      )}
    </div>
  );
}

function CampaignRow({ c, posts, onShow, onEdit }: { c: Campaign; posts: Post[]; onShow: (c: Campaign) => void; onEdit: () => void }) {
  const act = useFetcher<Answer>();
  const mine = posts.filter((p) => p.campaignId === c.id);
  const count = (s: string[]) => mine.filter((p) => s.includes(p.status)).length;
  if (act.state !== "idle" && act.formData?.get("intent") === "campaign-delete") return null;
  return (
    <div className="pc-campaign" style={{ ["--c" as string]: c.color }}>
      <i className="pc-swatch" />
      <div className="pc-campaign-main">
        <strong>{c.name}</strong>
        <span className="pc-muted">
          {c.startDay && c.endDay
            ? `${dayLabel(c.startDay, { day: "numeric", month: "short" })} – ${dayLabel(c.endDay, { day: "numeric", month: "short", year: "numeric" })}`
            : "No dates"}
          {" · "}
          {count(["scheduled"])} scheduled, {count(["sent", "partial"])} posted, {count(["draft"])} drafts
        </span>
        {c.note && <span>{c.note}</span>}
      </div>
      <div className="pc-row-actions">
        <button type="button" className="pc-btn" onClick={() => onShow(c)}>
          Show on calendar
        </button>
        <button type="button" className="pc-btn" onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="pc-btn"
          onClick={() =>
            act.submit(
              {
                intent: "campaign-archive",
                id: c.id,
                archived: String(!c.archived),
              },
              { method: "post" },
            )
          }
        >
          {c.archived ? "Restore" : "Archive"}
        </button>
        <button
          type="button"
          className="pc-btn pc-btn-danger"
          onClick={() =>
            confirm("Delete this campaign? Its posts stay on the calendar.") && act.submit({ intent: "campaign-delete", id: c.id }, { method: "post" })
          }
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CampaignForm({ campaign, onDone }: { campaign?: Campaign; onDone: () => void }) {
  const act = useFetcher<Answer>();
  const [f, setF] = useState({
    name: campaign?.name ?? "",
    color: campaign?.color ?? CAMPAIGN_COLORS[0],
    startDay: campaign?.startDay ?? "",
    endDay: campaign?.endDay ?? "",
    note: campaign?.note ?? "",
  });
  const saved = act.state === "idle" && act.data?.intent === "campaign" && !act.data.error;
  useEffect(() => {
    if (saved) onDone();
  }, [saved, onDone]);
  return (
    <div className="pc-campaign-form">
      <s-stack gap="base">
        <s-text-field label="Name" value={f.name} placeholder="Summer sale" onInput={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="small">
          <s-date-field label="Starts" value={f.startDay} onChange={(e) => setF({ ...f, startDay: e.currentTarget.value })} />
          <s-date-field label="Ends" value={f.endDay} onChange={(e) => setF({ ...f, endDay: e.currentTarget.value })} />
        </s-grid>
        <s-text-field label="Note" value={f.note} placeholder="Shown on the calendar bar" onInput={(e) => setF({ ...f, note: e.currentTarget.value })} />
        <div>
          <span className="pc-label">Colour</span>
          <div className="pc-colors">
            {CAMPAIGN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`pc-color${f.color === c ? " pc-color-on" : ""}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                onClick={() => setF({ ...f, color: c })}
              />
            ))}
          </div>
        </div>
        {act.state === "idle" && act.data?.error && <s-banner tone="warning">{act.data.error}</s-banner>}
        <s-stack direction="inline" gap="small">
          <s-button
            variant="primary"
            loading={act.state !== "idle"}
            onClick={() => act.submit({ intent: "campaign", id: campaign?.id ?? "", ...f }, { method: "post" })}
          >
            {campaign ? "Save campaign" : "Add campaign"}
          </s-button>
          <s-button variant="tertiary" onClick={onDone}>
            Cancel
          </s-button>
        </s-stack>
      </s-stack>
    </div>
  );
}

// --- Composer -----------------------------------------------------------------

const QUICK_TIMES = [
  { label: "Morning", time: "09:00" },
  { label: "Lunchtime", time: "12:30" },
  { label: "Evening", time: "18:30" },
];

const hashtags = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

function Composer({
  post,
  day,
  time,
  data,
  onClose,
  onDone,
}: {
  post?: Post;
  day?: string;
  time?: string;
  data: Data;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { accounts, campaigns, tz, today } = data;
  const start = post?.at ? zoned(new Date(post.at), tz) : null;
  const [picked, setPicked] = useState<string[]>(
    post?.accountIds.filter((id) => accounts.some((a) => a.id === id)) ?? (accounts.length === 1 ? [accounts[0].id] : []),
  );
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [captions, setCaptions] = useState<Partial<Record<Network, string>>>(post?.captions ?? {});
  const [tab, setTab] = useState<"all" | Network>("all");
  const [image, setImage] = useState<{ id: string; url: string } | null>(post?.imageId && post.image ? { id: post.imageId, url: post.image } : null);
  const [link, setLink] = useState(post?.link ?? "");
  const [campaignId, setCampaignId] = useState(post?.campaignId ?? "");
  const [when, setWhen] = useState({
    day: start?.day ?? day ?? today,
    time: start?.time ?? time ?? "09:00",
  });
  const [tiktok, setTiktok] = useState<Record<string, TikTokChoices | null>>(post?.tiktok ?? {});
  const [brief, setBrief] = useState<string | null>(null);
  const [preview, setPreview] = useState<Network | null>(null);
  const save = useFetcher<Answer>();
  const upload = useFetcher<Answer>();
  const ai = useFetcher<Answer>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pickedAccounts = accounts.filter((a) => picked.includes(a.id));
  const networks = NETWORKS.filter((n) => pickedAccounts.some((a) => a.network === n));
  const captionFor = (n: Network) => captions[n] || caption;
  const shownPreview = preview && networks.includes(preview) ? preview : networks[0];

  // Upload and AI answers land in the form.
  const uploaded = upload.state === "idle" ? upload.data : undefined;
  const [seenUpload, setSeenUpload] = useState(uploaded);
  if (uploaded !== seenUpload) {
    setSeenUpload(uploaded);
    if (uploaded?.imageId && uploaded.url) setImage({ id: uploaded.imageId, url: uploaded.url });
  }
  const written = ai.state === "idle" ? ai.data?.captions : undefined;
  const [seenWritten, setSeenWritten] = useState(written);
  if (written !== seenWritten) {
    setSeenWritten(written);
    if (written) {
      setCaption(written.caption);
      setCaptions({ facebook: written.facebook, instagram: written.instagram, tiktok: written.tiktok, pinterest: written.pinterest });
      setBrief(null);
    }
  }

  const saved = save.state === "idle" ? save.data : undefined;
  useEffect(() => {
    if (!saved || saved.error || saved.intent !== "save") return;
    const mode = save.formData?.get("mode");
    if (saved.status === "draft") onDone("Draft saved.");
    else if (saved.status === "scheduled")
      onDone(`Scheduled for ${dayLabel(when.day, { weekday: "long", day: "numeric", month: "long" })} at ${timeLabel(when.time)}.`);
    else if (saved.status === "sent") onDone(networks.includes("tiktok") ? "Posted. TikTok can take a few minutes to show it on your profile." : "Posted.");
    else if (saved.status === "partial")
      onDone(`Posted to ${saved.posted} of ${(saved.posted ?? 0) + (saved.failed ?? 0)} accounts. See Failed posts for the rest.`);
    else if (saved.status === "failed") onDone("The post didn't go out. See Failed posts for why.");
    else if (mode) onDone("Saved.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  // What would stop the post going out, shown before pressing anything.
  const issues: string[] = [];
  if (!picked.length) issues.push("Pick at least one account.");
  for (const n of networks) {
    const c = captionFor(n);
    if (!c.trim()) issues.push(`Write a caption for ${NETWORK_NAME[n]}.`);
    if (c.length > LIMITS[n]) issues.push(`The ${NETWORK_NAME[n]} caption is ${c.length - LIMITS[n]} characters too long.`);
    if (n !== "facebook" && !image) issues.push(`${NETWORK_NAME[n]} needs a picture.`);
  }
  if (networks.includes("instagram") && hashtags(captionFor("instagram")) > 30) issues.push("Instagram allows up to 30 hashtags.");
  for (const a of pickedAccounts) if (a.network === "tiktok" && !tiktok[a.id]) issues.push(`Finish the TikTok choices for ${a.name}.`);
  if (link && !/^https?:\/\/\S+$/i.test(link)) issues.push("The link needs to start with https://.");

  const submit = (mode: "draft" | "schedule" | "now") =>
    save.submit(
      {
        intent: "save",
        mode,
        id: post?.id ?? "",
        caption,
        captions: JSON.stringify(Object.fromEntries(networks.map((n) => [n, captions[n] ?? ""]))),
        accountIds: JSON.stringify(picked),
        tiktok: JSON.stringify(Object.fromEntries(Object.entries(tiktok).filter(([id, c]) => c && picked.includes(id)))),
        imageId: image?.id ?? "",
        link,
        campaignId,
        day: when.day,
        time: when.time,
        tz,
      },
      { method: "post" },
    );
  const sendFile = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("intent", "upload");
    fd.set("file", file);
    upload.submit(fd, { method: "post", encType: "multipart/form-data" });
  };
  const busy = (mode: string) => save.state !== "idle" && save.formData?.get("mode") === mode;
  const tabText = tab === "all" ? caption : (captions[tab] ?? "");
  const limit = tab === "all" ? Math.min(...(networks.length ? networks.map((n) => LIMITS[n]) : [LIMITS.instagram])) : LIMITS[tab];
  const past = when.day < today || (when.day === today && when.time <= zoned(new Date(), tz).time);

  return (
    <div className="pc-overlay" role="dialog" aria-modal="true" aria-label={post ? "Edit post" : "New post"}>
      <div className="pc-composer">
        <header className="pc-drawer-head">
          <h2>{post ? (post.status === "draft" ? "Edit draft" : post.status === "failed" ? "Fix and send again" : "Edit scheduled post") : "New post"}</h2>
          <button type="button" className="pc-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="pc-composer-body">
          <div className="pc-compose">
            <section>
              <span className="pc-label">Post to</span>
              {accounts.length === 0 ? (
                <p className="pc-muted">
                  No accounts connected. Connect them under <Link to="/app/social">Social accounts</Link>.
                </p>
              ) : (
                <div className="pc-accounts">
                  {accounts.map((a) => {
                    const on = picked.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`pc-account${on ? " pc-account-on" : ""}`}
                        aria-pressed={on}
                        onClick={() => setPicked(on ? picked.filter((x) => x !== a.id) : [...picked, a.id])}
                      >
                        <NetIcon n={a.network} size={20} />
                        <span>{a.name}</span>
                        <i className="pc-check">{on && <Glyph d={G.tick} size={12} />}</i>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="pc-caption-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "pc-tab-on" : ""} onClick={() => setTab("all")}>
                  Caption
                </button>
                {networks.map((n) => (
                  <button key={n} type="button" role="tab" aria-selected={tab === n} className={tab === n ? "pc-tab-on" : ""} onClick={() => setTab(n)}>
                    <NetIcon n={n} size={14} /> {NETWORK_NAME[n]}
                    {captions[n] && <i className="pc-tab-dot" title="Has its own caption" />}
                  </button>
                ))}
              </div>
              <div className="pc-editor">
                <textarea
                  value={tabText}
                  rows={7}
                  placeholder={tab === "all" ? "What do you want to share?" : `Uses the main caption. Write here to give ${NETWORK_NAME[tab]} its own.`}
                  onChange={(e) =>
                    tab === "all"
                      ? setCaption(e.currentTarget.value)
                      : setCaptions({
                          ...captions,
                          [tab]: e.currentTarget.value,
                        })
                  }
                />
                <div className="pc-editor-foot">
                  {data.ai && (
                    <button type="button" className="pc-ai" onClick={() => setBrief(brief == null ? "" : null)}>
                      ✦ Write with AI
                    </button>
                  )}
                  {tab !== "all" && captions[tab] && (
                    <button type="button" className="pc-link-btn" onClick={() => setCaptions({ ...captions, [tab]: "" })}>
                      Use the main caption
                    </button>
                  )}
                  {tab !== "all" && !captions[tab] && caption && (
                    <button type="button" className="pc-link-btn" onClick={() => setCaptions({ ...captions, [tab]: caption })}>
                      Start from the main caption
                    </button>
                  )}
                  <span className={`pc-count${tabText.length > limit ? " pc-bad" : ""}`}>
                    {tab === "instagram" || (tab === "all" && networks.includes("instagram")) ? `${hashtags(tabText)}/30 hashtags · ` : ""}
                    {tabText.length.toLocaleString("en-GB")}/{limit.toLocaleString("en-GB")}
                  </span>
                </div>
              </div>
              {brief != null && (
                <div className="pc-brief">
                  <s-text-field
                    label="What's the post about?"
                    value={brief}
                    placeholder="New autumn candles are in, 3 scents, free UK delivery over £30"
                    onInput={(e) => setBrief(e.currentTarget.value)}
                  />
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-button loading={ai.state !== "idle"} onClick={() => ai.submit({ intent: "ai", brief, draft: caption }, { method: "post" })}>
                      Write captions
                    </s-button>
                    <s-text color="subdued">Writes one caption, plus one for each network you can change.</s-text>
                  </s-stack>
                  {ai.state === "idle" && ai.data?.error && <s-text tone="critical">{ai.data.error}</s-text>}
                </div>
              )}
            </section>

            <section>
              <span className="pc-label">Picture</span>
              {image ? (
                <div className="pc-image">
                  <img src={image.url} alt="" />
                  <div>
                    <button type="button" className="pc-btn" onClick={() => fileRef.current?.click()}>
                      Replace
                    </button>
                    <button type="button" className="pc-btn pc-btn-danger" onClick={() => setImage(null)}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={`pc-drop-zone${dragging ? " pc-dragging" : ""}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    sendFile(e.dataTransfer.files[0]);
                  }}
                >
                  {upload.state !== "idle" ? "Uploading…" : "Drop a picture here, or choose one"}
                  <small>JPG, PNG or WebP. Instagram and TikTok need one.</small>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => sendFile(e.currentTarget.files?.[0])} />
              {upload.state === "idle" && upload.data?.error && <s-text tone="critical">{upload.data.error}</s-text>}
            </section>

            <section className="pc-two">
              <s-text-field
                label="Link (optional)"
                value={link}
                placeholder="https://"
                details="Added under the Facebook post and opened from the Pinterest pin. Instagram and TikTok don't allow links in captions."
                onInput={(e) => setLink(e.currentTarget.value)}
              />
              <s-select label="Campaign" value={campaignId} onChange={(e) => setCampaignId(e.currentTarget.value)}>
                <s-option value="">No campaign</s-option>
                {campaigns
                  .filter((c) => !c.archived || c.id === campaignId)
                  .map((c) => (
                    <s-option key={c.id} value={c.id}>
                      {c.name}
                    </s-option>
                  ))}
              </s-select>
            </section>

            {pickedAccounts
              .filter((a) => a.network === "tiktok")
              .map((a) => (
                <section key={a.id}>
                  <TikTokPost
                    accountId={a.id}
                    picture={image?.url ?? null}
                    caption={captionFor("tiktok")}
                    initial={post?.tiktok[a.id]}
                    onChange={(c) => setTiktok((t) => ({ ...t, [a.id]: c }))}
                  />
                </section>
              ))}

            <section className="pc-when">
              <span className="pc-label">When</span>
              <div className="pc-when-row">
                <s-date-field
                  label="Day"
                  labelAccessibilityVisibility="exclusive"
                  value={when.day}
                  allow={`${today}--`}
                  onChange={(e) => setWhen({ ...when, day: e.currentTarget.value })}
                />
                <input
                  className="pc-time"
                  type="time"
                  aria-label="Time"
                  value={when.time}
                  onChange={(e) => setWhen({ ...when, time: e.currentTarget.value })}
                />
                {QUICK_TIMES.map((q) => (
                  <button
                    key={q.time}
                    type="button"
                    className={`pc-chip${when.time === q.time ? " pc-chip-on" : ""}`}
                    onClick={() => setWhen({ ...when, time: q.time })}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <small className="pc-muted">Your shop&apos;s time ({tz.replace(/_/g, " ")}).</small>
            </section>
          </div>

          <aside className="pc-previews">
            <div className="pc-preview-tabs">
              {networks.map((n) => (
                <button key={n} type="button" className={shownPreview === n ? "pc-tab-on" : ""} onClick={() => setPreview(n)}>
                  <NetIcon n={n} size={14} /> {NETWORK_NAME[n]}
                </button>
              ))}
            </div>
            {shownPreview ? (
              <Preview
                n={shownPreview}
                name={pickedAccounts.find((a) => a.network === shownPreview)?.name ?? ""}
                caption={captionFor(shownPreview)}
                image={image?.url ?? null}
                link={shownPreview === "facebook" ? link : ""}
              />
            ) : (
              <div className="pc-empty">Pick an account to see a preview.</div>
            )}
          </aside>
        </div>
        <footer className="pc-composer-foot">
          {save.state === "idle" && saved?.error && <s-banner tone="warning">{saved.error}</s-banner>}
          {issues.length > 0 && <p className="pc-issues">{issues[0]}</p>}
          <div className="pc-foot-buttons">
            <button type="button" className="pc-btn" disabled={save.state !== "idle"} onClick={() => submit("draft")}>
              {busy("draft") ? "Saving…" : "Save draft"}
            </button>
            <button type="button" className="pc-btn" disabled={save.state !== "idle" || issues.length > 0} onClick={() => submit("now")}>
              {busy("now") ? "Posting…" : "Post now"}
            </button>
            <button
              type="button"
              className="pc-btn pc-btn-primary"
              disabled={save.state !== "idle" || issues.length > 0 || past}
              onClick={() => submit("schedule")}
            >
              {busy("schedule")
                ? "Scheduling…"
                : past
                  ? "Pick a later time"
                  : `Schedule for ${dayLabel(when.day, { day: "numeric", month: "short" })}, ${timeLabel(when.time)}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Roughly how the post will look on each network.
function Preview({ n, name, caption, image, link }: { n: Network; name: string; caption: string; image: string | null; link: string }) {
  const text = caption.split(/(#[\p{L}\p{N}_]+)/gu).map((part, i) => (part.startsWith("#") ? <b key={i}>{part}</b> : part));
  const avatar = (
    <span className="pc-avatar" style={{ background: NET_COLOR[n] }}>
      {(name.replace("@", "")[0] ?? "S").toUpperCase()}
    </span>
  );
  if (n === "pinterest") {
    return (
      <div className="pc-pv pc-pv-pin">
        {image ? <img src={image} alt="" /> : <div className="pc-pv-noimg">Add a picture</div>}
        <strong>{caption.split("\n")[0].slice(0, 100) || "Pin title"}</strong>
        <p>{text.length ? text : "Your description"}</p>
        <span className="pc-pv-pin-board">
          {avatar} {name}
        </span>
      </div>
    );
  }
  if (n === "tiktok") {
    return (
      <div className="pc-pv pc-pv-tiktok">
        {image ? <img src={image} alt="" /> : <div className="pc-pv-noimg">Add a picture</div>}
        <div className="pc-pv-tt-text">
          <strong>{name}</strong>
          <p>{text.length ? text : "Your caption"}</p>
        </div>
      </div>
    );
  }
  if (n === "instagram") {
    return (
      <div className="pc-pv">
        <div className="pc-pv-head">
          {avatar}
          <strong>{name.replace(/^@/, "")}</strong>
        </div>
        {image ? <img className="pc-pv-square" src={image} alt="" /> : <div className="pc-pv-noimg pc-pv-square">Add a picture</div>}
        <p className="pc-pv-text">
          <strong>{name.replace(/^@/, "")}</strong> {text.length ? text : "Your caption"}
        </p>
      </div>
    );
  }
  let host = "";
  try {
    host = link ? new URL(link).host : "";
  } catch {
    host = "";
  }
  return (
    <div className="pc-pv">
      <div className="pc-pv-head">
        {avatar}
        <span>
          <strong>{name}</strong>
          <small>Just now</small>
        </span>
      </div>
      <p className="pc-pv-text">
        {text.length ? text : "Your caption"}
        {link && (
          <>
            <br />
            <a href={link} target="_blank" rel="noreferrer">
              {link}
            </a>
          </>
        )}
      </p>
      {image && <img className="pc-pv-wide" src={image} alt="" />}
      {!image && host && <div className="pc-pv-link">{host.toUpperCase()}</div>}
    </div>
  );
}

const CSS = `
.pc-shell { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 16px; align-items: start; margin-top: 12px; }
.pc-rail { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 2px; padding: 10px; border-radius: 14px; background: #1d2433; color: #d7dce6; }
.pc-rail-new { display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 8px; padding: 9px 10px; border: 0; border-radius: 9px; background: #4f7cff; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.pc-rail-new:hover { background: #3f6af0; }
.pc-rail-item { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.pc-rail-item:hover { background: #2a3347; }
.pc-rail-on { background: #344058; color: #fff; font-weight: 600; }
.pc-rail-item span { flex: 1; }
.pc-rail-item em { min-width: 20px; padding: 1px 6px; border-radius: 10px; background: #3c475f; font-style: normal; font-size: 11px; text-align: center; }
.pc-rail-item em.pc-count-bad { background: #e5484d; color: #fff; }
.pc-rail-foot { margin-top: 10px; padding: 8px 10px 2px; border-top: 1px solid #2f384b; font-size: 11px; line-height: 1.5; color: #9aa4b8; }
.pc-rail-foot a { color: #b9c8ff; }
.pc-main { min-width: 0; padding: 14px; border: 1px solid #e3e3e3; border-radius: 14px; background: #fff; }
.pc-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.pc-nav, .pc-filters, .pc-netfilter { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pc-range { margin-left: 6px; font-size: 15px; }
.pc-btn { padding: 6px 12px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; color: #303030; font: inherit; font-size: 13px; cursor: pointer; }
.pc-btn:hover:not(:disabled) { background: #f3f3f3; }
.pc-btn:disabled { opacity: .5; cursor: default; }
.pc-btn-icon { width: 32px; padding: 6px 0; font-size: 16px; line-height: 1; }
.pc-btn-primary { border-color: #303030; background: #303030; color: #fff; }
.pc-btn-primary:hover:not(:disabled) { background: #1a1a1a; }
.pc-btn-danger { color: #c4291c; }
.pc-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px 4px 5px; border: 1px solid #d4d4d4; border-radius: 16px; background: #fff; color: #8a8a8a; font: inherit; font-size: 12px; cursor: pointer; }
.pc-chip-on { border-color: #303030; color: #303030; background: #f4f4f4; }
.pc-chip:not(.pc-chip-on) .pc-net { filter: grayscale(1); opacity: .45; }
.pc-select { padding: 5px 8px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; font: inherit; font-size: 13px; }
.pc-seg { display: inline-flex; padding: 2px; border-radius: 9px; background: #efefef; }
.pc-seg button { padding: 5px 12px; border: 0; border-radius: 7px; background: none; font: inherit; font-size: 13px; color: #616161; cursor: pointer; }
.pc-seg .pc-seg-on { background: #fff; color: #303030; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.pc-net { display: inline-grid; place-items: center; flex: none; border-radius: 50%; }
.pc-net-facebook { background: #1877f2; }
.pc-net-instagram { background: radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285aeb 90%); border-radius: 30%; }
.pc-net-tiktok { background: #111; }
.pc-net-pinterest { background: #e60023; }
.pc-pv-pin { padding: 10px; border: 0; background: transparent; }
.pc-pv-pin img, .pc-pv-pin .pc-pv-noimg { display: block; width: 100%; border-radius: 16px; aspect-ratio: auto; max-height: 420px; object-fit: cover; }
.pc-pv-pin .pc-pv-noimg { aspect-ratio: 2 / 3; }
.pc-pv-pin strong { display: block; margin: 10px 4px 4px; font-size: 15px; }
.pc-pv-pin p { margin: 0 4px 10px; white-space: pre-line; color: #4a4a4a; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.pc-pv-pin p b { color: #4a4a4a; font-weight: 600; }
.pc-pv-pin-board { display: flex; align-items: center; gap: 8px; margin: 0 4px; font-size: 12px; color: #616161; }
.pc-pv-pin-board .pc-avatar { width: 24px; height: 24px; font-size: 11px; }
.pc-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: auto; border: 1px solid #e3e3e3; border-radius: 12px; overflow: hidden; }
.pc-week-head { display: flex; align-items: baseline; justify-content: center; gap: 6px; padding: 8px 4px; border-right: 1px solid #ececec; border-bottom: 1px solid #e3e3e3; background: #fafafa; font-size: 12px; color: #616161; }
.pc-week-head:nth-child(7) { border-right: 0; }
.pc-week-head strong { font-size: 15px; color: #303030; }
.pc-week-head.pc-today { background: #eef3ff; box-shadow: inset 0 -2px 0 #4f7cff; }
.pc-week-head.pc-today strong { color: #3459d6; }
.pc-bar { display: flex; align-items: center; gap: 8px; margin: 6px 4px 0; padding: 5px 10px; border: 1px solid var(--c); border-left-width: 4px; border-radius: 8px; background: color-mix(in srgb, var(--c) 9%, #fff); font-size: 12px; min-width: 0; }
.pc-bar strong { color: var(--c); white-space: nowrap; }
.pc-bar span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #4a4a4a; }
.pc-bar em { font-style: normal; color: #616161; white-space: nowrap; }
.pc-week-col { display: flex; flex-direction: column; gap: 8px; min-height: 420px; padding: 8px 6px; border-right: 1px solid #ececec; min-width: 0; transition: background .1s; }
.pc-week-col.pc-last { border-right: 0; }
.pc-bars { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px 0; padding-bottom: 6px; border-bottom: 1px solid #ececec; }
.pc-past { background: #fbfbfb; }
.pc-drop { background: #eef3ff; outline: 2px dashed #4f7cff; outline-offset: -4px; }
.pc-card { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 8px; border: 1px solid #e1e1e1; border-radius: 10px; background: #fff; color: #303030; font: inherit; text-align: left; text-decoration: none; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.05); min-width: 0; }
.pc-card:hover { border-color: #b5b5b5; box-shadow: 0 2px 6px rgba(0,0,0,.08); }
.pc-card[draggable="true"] { cursor: grab; }
.pc-card-draft { border-style: dashed; background: #fcfcfc; }
.pc-card-failed, .pc-card-partial { border-color: #f3b8b8; background: #fffafa; }
.pc-card-sending { border-color: #f1d089; }
.pc-card-blog { border-color: #d9d2f5; background: #f8f6ff; }
.pc-card-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.pc-card-nets { display: flex; gap: 2px; flex-wrap: wrap; }
.pc-card-time { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; white-space: nowrap; color: #3459d6; }
.pc-time-draft { color: #8a8a8a; } .pc-time-sent { color: #0f7a4f; } .pc-time-failed, .pc-time-partial { color: #c4291c; } .pc-time-sending { color: #8a5a00; }
.pc-card-body { display: flex; gap: 6px; align-items: flex-start; }
.pc-card-text { flex: 1; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.pc-card-body img { flex: none; width: 42px; height: 42px; object-fit: cover; border-radius: 6px; }
.pc-card-foot { display: flex; flex-wrap: wrap; gap: 4px; }
.pc-tag { display: inline-block; max-width: 100%; padding: 1px 7px; border-radius: 10px; background: color-mix(in srgb, var(--c, #888) 14%, #fff); color: var(--c, #555); font-size: 11px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-tag-plain { --c: #6b6b6b; }
.pc-tag-bad { --c: #c4291c; }
.pc-blog-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #6d4aff; }
.pc-add { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 8px 4px; border: 1px dashed #d4d4d4; border-radius: 10px; background: none; color: #8a8a8a; font: inherit; font-size: 12px; cursor: pointer; opacity: 0; transition: opacity .15s; }
.pc-week-col:hover .pc-add, .pc-add:focus-visible { opacity: 1; }
.pc-add:hover { border-color: #4f7cff; color: #3459d6; background: #f5f8ff; }
@media (hover: none) { .pc-add { opacity: 1; } }
.pc-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12px; color: #616161; }
.pc-legend-tip { margin-left: auto; }
.pc-dot { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 3px; vertical-align: -1px; }
.pc-dot-scheduled { background: #4f7cff; } .pc-dot-draft { background: #fff; border: 1px dashed #8a8a8a; } .pc-dot-sent { background: #1baf7a; } .pc-dot-failed { background: #e5484d; } .pc-dot-blog { background: #b9a8ff; }
.pc-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border: 1px solid #e3e3e3; border-radius: 12px; overflow: hidden; }
.pc-month-head { padding: 7px 8px; border-bottom: 1px solid #e3e3e3; background: #fafafa; font-size: 12px; font-weight: 600; color: #616161; }
.pc-month-cell { display: flex; flex-direction: column; gap: 3px; min-height: 118px; padding: 6px; border-right: 1px solid #ececec; border-bottom: 1px solid #ececec; min-width: 0; }
.pc-month-cell:nth-child(7n) { border-right: 0; }
.pc-out { background: #f8f8f8; color: #aaa; }
.pc-month-date { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #616161; }
.pc-today-dot { padding: 0 7px; border-radius: 9px; background: #4f7cff; color: #fff; font-weight: 600; }
.pc-month-add { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: none; color: #8a8a8a; cursor: pointer; opacity: 0; }
.pc-month-cell:hover .pc-month-add { opacity: 1; }
.pc-month-add:hover { background: #eef3ff; color: #3459d6; }
.pc-pill { display: flex; align-items: center; gap: 4px; width: 100%; padding: 3px 5px; border: 0; border-left: 3px solid var(--c, #4f7cff); border-radius: 5px; background: #f3f6ff; color: #303030; font: inherit; font-size: 11px; text-align: left; text-decoration: none; cursor: pointer; min-width: 0; }
.pc-pill span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-pill b { white-space: nowrap; }
.pc-pill-nets { display: flex; gap: 1px; flex: none; }
.pc-pill-draft { background: #f6f6f6; border-left-style: dashed; border-left-color: var(--c, #999); }
.pc-pill-sent { background: #eefaf4; border-left-color: var(--c, #1baf7a); }
.pc-pill-failed, .pc-pill-partial { background: #fdf1f1; border-left-color: #e5484d; }
.pc-pill-blog { background: #f6f3ff; border-left-color: #b9a8ff; color: #4b3a99; }
.pc-more { padding: 2px; border: 0; background: none; color: #3459d6; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.pc-list-day h3, .pc-list-head { margin: 14px 0 8px; font-size: 13px; color: #616161; }
.pc-list-today { color: #3459d6 !important; }
.pc-list-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.pc-empty { padding: 30px 10px; border: 1px dashed #d4d4d4; border-radius: 12px; text-align: center; color: #8a8a8a; font-size: 13px; }
.pc-panel h2 { margin: 0; font-size: 17px; }
.pc-panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.pc-muted { margin: 4px 0 12px; color: #616161; font-size: 13px; }
.pc-row { display: grid; grid-template-columns: 92px 64px minmax(0, 1fr); gap: 12px; align-items: start; width: 100%; margin-bottom: 8px; padding: 10px; border: 1px solid #e3e3e3; border-radius: 12px; background: #fff; font: inherit; text-align: left; color: inherit; }
.pc-row-button { cursor: pointer; } .pc-row-button:hover { border-color: #b5b5b5; }
.pc-row-draft { border-style: dashed; }
.pc-row-failed, .pc-row-partial { border-color: #f3b8b8; }
.pc-row-when { display: flex; flex-direction: column; font-size: 12px; color: #616161; }
.pc-row-when strong { font-size: 14px; color: #303030; }
.pc-row-img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; }
.pc-row-noimg { background: repeating-linear-gradient(45deg, #f4f4f4 0 6px, #fafafa 6px 12px); }
.pc-row-accounts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pc-acct { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #4a4a4a; }
.pc-acct-bad { color: #c4291c; }
.pc-row-text { margin: 6px 0; font-size: 13px; line-height: 1.45; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.pc-row-error { display: flex; align-items: center; gap: 5px; margin: 4px 0; font-size: 12px; color: #c4291c; }
.pc-row-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pc-campaign { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 12px; align-items: center; margin-bottom: 8px; padding: 12px; border: 1px solid #e3e3e3; border-left: 4px solid var(--c); border-radius: 12px; }
.pc-swatch { width: 12px; height: 12px; border-radius: 50%; background: var(--c); }
.pc-campaign-main { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.pc-campaign-main .pc-muted { margin: 0; }
.pc-campaign-form { margin: 12px 0; padding: 14px; border: 1px solid #e3e3e3; border-radius: 12px; background: #fafafa; }
.pc-archived summary { margin: 12px 0 8px; cursor: pointer; color: #616161; font-size: 13px; }
.pc-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #303030; }
.pc-colors { display: flex; gap: 8px; }
.pc-color { width: 26px; height: 26px; border: 2px solid #fff; border-radius: 50%; cursor: pointer; box-shadow: 0 0 0 1px #d4d4d4; }
.pc-color-on { box-shadow: 0 0 0 2px #303030; }
.pc-overlay { position: fixed; inset: 0; z-index: 50; display: flex; justify-content: center; align-items: flex-start; padding: 24px 16px; background: rgba(20, 24, 33, .45); overflow-y: auto; }
.pc-composer { display: flex; flex-direction: column; width: min(1120px, 100%); border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
.pc-drawer { width: min(560px, 100%); margin-left: auto; border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
.pc-drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #ececec; }
.pc-drawer-head h2 { margin: 0; font-size: 16px; }
.pc-close { width: 32px; height: 32px; border: 0; border-radius: 50%; background: #f3f3f3; font-size: 20px; line-height: 1; cursor: pointer; }
.pc-close:hover { background: #e6e6e6; }
.pc-drawer-body { padding: 16px 18px; }
.pc-drawer-body h3 { margin: 16px 0 8px; font-size: 13px; }
.pc-drawer-foot { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 18px; border-top: 1px solid #ececec; }
.pc-detail-img { display: block; width: 100%; max-height: 320px; margin-top: 10px; object-fit: contain; border-radius: 10px; background: #f4f4f4; }
.pc-detail-text { white-space: pre-line; font-size: 14px; line-height: 1.5; }
.pc-results { margin: 0; padding: 0; list-style: none; }
.pc-results li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.pc-results li > span:not(.pc-net) { flex: 1; display: flex; flex-direction: column; }
.pc-results em { font-style: normal; color: #616161; font-size: 12px; }
.pc-bad { color: #c4291c !important; }
.pc-composer-body { display: grid; grid-template-columns: minmax(0, 1fr) 340px; }
.pc-compose { display: flex; flex-direction: column; gap: 18px; padding: 18px; border-right: 1px solid #ececec; }
.pc-accounts { display: flex; flex-wrap: wrap; gap: 8px; }
.pc-account { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 6px; border: 1px solid #d4d4d4; border-radius: 22px; background: #fff; font: inherit; font-size: 13px; cursor: pointer; }
.pc-account-on { border-color: #4f7cff; background: #f2f6ff; }
.pc-check { display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid #c9c9c9; border-radius: 50%; color: #fff; }
.pc-account-on .pc-check { border-color: #4f7cff; background: #4f7cff; }
.pc-caption-tabs, .pc-preview-tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid #e3e3e3; }
.pc-caption-tabs button, .pc-preview-tabs button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 10px; border: 0; border-bottom: 2px solid transparent; background: none; font: inherit; font-size: 13px; color: #616161; cursor: pointer; }
.pc-tab-on { border-bottom-color: #303030 !important; color: #303030 !important; font-weight: 600; }
.pc-tab-dot { width: 6px; height: 6px; border-radius: 50%; background: #4f7cff; }
.pc-editor { border: 1px solid #d4d4d4; border-top: 0; border-radius: 0 0 10px 10px; }
.pc-editor:focus-within { border-color: #4f7cff; }
.pc-editor textarea { display: block; width: 100%; box-sizing: border-box; padding: 12px; border: 0; outline: none; resize: vertical; font: inherit; font-size: 14px; line-height: 1.5; }
.pc-editor-foot { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-top: 1px solid #f0f0f0; background: #fafafa; border-radius: 0 0 10px 10px; }
.pc-ai { padding: 4px 10px; border: 0; border-radius: 14px; background: linear-gradient(90deg, #6d4aff, #4f7cff); color: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.pc-link-btn { padding: 0; border: 0; background: none; color: #3459d6; font: inherit; font-size: 12px; cursor: pointer; }
.pc-count { margin-left: auto; font-size: 12px; color: #8a8a8a; }
.pc-brief { margin-top: 10px; padding: 12px; border-radius: 10px; background: #f6f3ff; display: flex; flex-direction: column; gap: 8px; }
.pc-image { display: flex; gap: 12px; align-items: flex-end; }
.pc-image img { width: 160px; max-height: 160px; object-fit: cover; border-radius: 10px; }
.pc-image div { display: flex; gap: 6px; }
.pc-drop-zone { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; padding: 22px; border: 2px dashed #d4d4d4; border-radius: 12px; background: #fafafa; font: inherit; font-size: 13px; color: #4a4a4a; cursor: pointer; }
.pc-drop-zone small { color: #8a8a8a; }
.pc-drop-zone:hover, .pc-dragging { border-color: #4f7cff; background: #f5f8ff; }
.pc-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.pc-when-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pc-time { padding: 7px 8px; border: 1px solid #8a8a8a; border-radius: 8px; font: inherit; font-size: 13px; }
.pc-previews { padding: 18px; background: #f7f7f8; border-radius: 0 16px 0 0; }
.pc-preview-tabs { margin-bottom: 12px; }
.pc-pv { overflow: hidden; border: 1px solid #e3e3e3; border-radius: 12px; background: #fff; font-size: 13px; }
.pc-pv-head { display: flex; align-items: center; gap: 8px; padding: 10px; }
.pc-pv-head span { display: flex; flex-direction: column; }
.pc-pv-head small { color: #8a8a8a; font-size: 11px; }
.pc-avatar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 13px; }
.pc-pv-text { margin: 0; padding: 8px 10px 12px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.pc-pv-text b { color: #3459d6; font-weight: 500; }
.pc-pv-wide { display: block; width: 100%; max-height: 300px; object-fit: cover; }
.pc-pv-square { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
.pc-pv-noimg { display: grid; place-items: center; aspect-ratio: 1; background: #efefef; color: #8a8a8a; }
.pc-pv-link { padding: 10px; background: #f0f2f5; color: #616161; font-size: 11px; }
.pc-pv-tiktok { position: relative; aspect-ratio: 9 / 16; max-height: 520px; margin: 0 auto; background: #111; color: #fff; }
.pc-pv-tiktok img, .pc-pv-tiktok .pc-pv-noimg { width: 100%; height: 100%; object-fit: cover; aspect-ratio: auto; }
.pc-pv-tt-text { position: absolute; left: 0; right: 0; bottom: 0; padding: 40px 12px 14px; background: linear-gradient(transparent, rgba(0,0,0,.7)); }
.pc-pv-tt-text p { margin: 4px 0 0; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.pc-pv-tt-text b { font-weight: 600; }
.pc-composer-foot { position: sticky; bottom: 0; display: flex; flex-direction: column; gap: 8px; padding: 12px 18px; border-top: 1px solid #ececec; background: #fff; border-radius: 0 0 16px 16px; }
.pc-issues { margin: 0; font-size: 12px; color: #8a5a00; }
.pc-foot-buttons { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
@media (max-width: 1000px) {
  .pc-shell { grid-template-columns: 1fr; }
  .pc-rail { position: static; flex-direction: row; flex-wrap: wrap; }
  .pc-rail-new { margin: 0 8px 0 0; }
  .pc-rail-foot { display: none; }
  .pc-composer-body { grid-template-columns: 1fr; }
  .pc-compose { border-right: 0; }
  .pc-previews { border-radius: 0; }
}
@media (max-width: 760px) {
  .pc-week { grid-template-columns: 1fr; }
  .pc-week-head { display: none; }
  .pc-bars { grid-template-columns: 1fr; } .pc-bar { grid-column: 1 / -1 !important; }
  .pc-week-col { min-height: 0; border-right: 0; border-bottom: 1px solid #ececec; }
  .pc-month-cell { min-height: 64px; }
  .pc-pill span:last-child { display: none; }
  .pc-row { grid-template-columns: 70px minmax(0, 1fr); }
  .pc-row-img { display: none; }
}
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
