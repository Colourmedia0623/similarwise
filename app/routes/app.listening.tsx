import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { claudeJson } from "../lib/ideas/claude.server";
import { detectAiBrand } from "../lib/ai/mentions.server";
import { listenClients } from "../lib/listening/sources.server";
import { SOURCES } from "../lib/listening/sources";
import { addKeyword, askListening, deleteKeyword, editTopic, listeningView, startListening, suggestKeywords, syncTopics } from "../lib/listening/listening.server";
import { HowTo } from "../components/HowTo";

// Social listening: what people say on Reddit, YouTube, TikTok and across the
// web about the shop, its competitors and the keywords it follows, with
// Claude's read on the sentiment, the themes trending, and what to do next.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  await detectAiBrand(shop, async () => {
    const res = (await (await admin.graphql(`#graphql
      query ListeningShopName { shop { name } }`)).json()) as { data?: { shop?: { name?: string } } };
    return res.data?.shop?.name ?? null;
  });
  await syncTopics(shop);
  const url = new URL(request.url);
  const filters = { topic: url.searchParams.get("topic"), source: url.searchParams.get("source"), sentiment: url.searchParams.get("sentiment") };
  const clients = listenClients();
  return {
    on: clients.length > 0,
    sourcesOn: clients.map((c) => c.source),
    writer: claudeJson() != null,
    ...(await listeningView(shop, filters)),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const text = (k: string) => String(form.get(k) ?? "");
  if (intent === "check") return { intent, ...(await startListening(shop)) };
  if (intent === "add") return { intent, ...(await addKeyword(shop, text("keyword"))) };
  if (intent === "edit") return { intent, id, ...(await editTopic(shop, id, text("terms"))) };
  if (intent === "delete") {
    await deleteKeyword(shop, id);
    return { intent, id, ok: true as const };
  }
  if (intent === "suggest") {
    try {
      return { intent, ...(await suggestKeywords(shop)) };
    } catch (err) {
      console.error("Couldn't suggest listening keywords", shop, err);
      return { intent, error: "Couldn't think of keywords just now. Try again in a minute." };
    }
  }
  if (intent === "ask") {
    try {
      return { intent, ...(await askListening(shop, text("question"))) };
    } catch (err) {
      console.error("Couldn't answer a listening question", shop, err);
      return { intent, error: "Couldn't answer that just now. Try again in a minute." };
    }
  }
  return { error: "Unknown action" };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Topic = Data["topics"][number];

// Fixed in this order, so a brand keeps its colour whichever are shown.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const SOURCE_NAME: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.key, s.name]));
const FEELING = { positive: "Positive", neutral: "Neutral", negative: "Negative" } as const;
const QUESTIONS = ["What themes are trending this week?", "What do people complain about with my competitors?", "What do people like about us?", "What should I post about next?"];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const signed = (v: number | null) => (v == null ? "–" : v > 0 ? `+${v}` : `${v}`);
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

export default function Listening() {
  const d = useLoaderData<typeof loader>();
  const check = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const checking = d.running || (check.state !== "idle" && check.formData?.get("intent") === "check");
  const checkError = check.state === "idle" && check.data && "error" in check.data ? check.data.error : null;
  const started = check.state === "idle" && check.data && "started" in check.data;
  const brands = d.topics.filter((t) => t.kind !== "keyword");
  const colorOf = new Map(brands.map((t, i) => [t.id, SERIES[i % SERIES.length]]));
  const anything = d.topics.some((t) => t.total > 0);

  // Mentions come in over a few minutes, so keep looking while a check runs.
  useEffect(() => {
    if (!d.running && !started) return;
    const t = setInterval(() => revalidator.revalidate(), 10_000);
    return () => clearInterval(t);
  }, [d.running, started, revalidator]);

  return (
    <s-page heading="Social listening">
      <HowTo video="social-listening" />
      {d.on && (
        <s-button slot="primary-action" variant="primary" loading={checking} disabled={!d.topics.length} onClick={() => check.submit({ intent: "check" }, { method: "post" })}>
          Check now
        </s-button>
      )}
      {!d.on && <s-banner tone="info">Social listening isn&apos;t switched on for this app yet.</s-banner>}
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Hear what shoppers say about you, your competitors and the things you sell, on {SOURCES.filter((s) => d.sourcesOn.includes(s.key)).map((s) => s.name).join(", ") || "Reddit, YouTube, TikTok and the web"}. Every few
            days SimilarWise collects the latest posts, videos and pages, reads how each one feels and what it&apos;s about, and tells you what to do with it.
          </s-paragraph>
          {checking && <s-banner tone="info">Looking for new mentions and reading them. This takes a few minutes; the page updates by itself.</s-banner>}
          {checkError && <s-banner tone="warning">{checkError}</s-banner>}
          {d.error && !checking && <s-banner tone="warning">{d.error}</s-banner>}
          {d.checkedAt && !checking && (
            <s-text color="subdued">
              Last checked {longDay(d.checkedAt)}. Checked again every three days.
              {d.unread > 0 ? ` ${d.unread} mentions are still to be read.` : ""}
            </s-text>
          )}
          {!d.checkedAt && !checking && d.on && <s-text color="subdued">Press Check now to collect your first mentions.</s-text>}
        </s-stack>
      </s-section>

      {(d.insights || anything) && <Insights d={d} />}

      {anything && (
        <s-section heading="Share of voice and sentiment">
          <s-stack gap="base">
            <s-paragraph>The last 30 days of mentions for you and each competitor: how much of the conversation each gets, and how it feels.</s-paragraph>
            <div className="sw-ls-voice" role="table" aria-label="Share of voice and sentiment">
              <div className="sw-ls-vhead" role="row">
                <span role="columnheader">Brand</span>
                <span role="columnheader">Mentions</span>
                <span role="columnheader">Share of voice</span>
                <span role="columnheader">Sentiment</span>
                <span role="columnheader" title="Positive share less negative share, from -100 to +100">Net</span>
              </div>
              {brands.map((t) => {
                const v = d.voice.find((x) => x.id === t.id);
                const change = t.before ? Math.round((100 * (t.month - t.before)) / t.before) : null;
                return (
                  <div key={t.id} className={`sw-ls-vrow${t.kind === "brand" ? " sw-ls-you" : ""}`} role="row">
                    <span className="sw-ls-vname" role="cell">
                      <i style={{ background: colorOf.get(t.id) }} />
                      {t.kind === "brand" ? `${t.name} (you)` : t.name}
                    </span>
                    <span role="cell">
                      <strong>{t.month}</strong>
                      {change != null && <em className={change > 0 ? "sw-up" : change < 0 ? "sw-down" : ""}>{change > 0 ? `↑ ${change}%` : change < 0 ? `↓ ${-change}%` : "same"}</em>}
                    </span>
                    <span role="cell" className="sw-ls-share">
                      <span className="sw-ls-track">
                        <i style={{ width: `${v?.share ?? 0}%`, background: colorOf.get(t.id) }} />
                      </span>
                      <b>{v?.share == null ? "–" : `${v.share}%`}</b>
                    </span>
                    <span role="cell">
                      <SentimentBar s={t} />
                    </span>
                    <span role="cell" className="sw-ls-net">
                      {signed(t.net)}
                    </span>
                  </div>
                );
              })}
            </div>
            {brands.length < 2 && (
              <s-text color="subdued">
                Add competitors on the <s-link href="/app/competitors">Competitors</s-link> page to see how you compare.
              </s-text>
            )}
          </s-stack>
        </s-section>
      )}

      {anything && <TrendChart d={d} brands={brands} colorOf={colorOf} />}

      {d.themes.length > 0 && (
        <s-section heading="Trending this week">
          <s-stack gap="small">
            <s-paragraph>What people talked about in the last seven days, against the three weeks before.</s-paragraph>
            <div className="sw-ls-themes">
              {d.themes.map((t) => (
                <div key={t.theme} className="sw-ls-theme">
                  <div className="sw-ls-ttop">
                    <strong>{t.theme}</strong>
                    {t.rising && <s-badge tone="info">{t.before === 0 ? "New" : "Rising"}</s-badge>}
                  </div>
                  <span className="sw-ls-tcount">
                    {t.week === 1 ? "1 mention" : `${t.week} mentions`}
                    {t.change != null && <em className={t.change > 0 ? "sw-up" : t.change < 0 ? "sw-down" : ""}>{t.change > 0 ? ` ↑ ${t.change}%` : t.change < 0 ? ` ↓ ${-t.change}%` : " same"}</em>}
                  </span>
                  <SentimentBar s={t} />
                </div>
              ))}
            </div>
          </s-stack>
        </s-section>
      )}

      <Topics d={d} />
      {anything && <Feed d={d} />}
      <style>{CSS}</style>
    </s-page>
  );
}

function SentimentBar({ s }: { s: { positive: number; neutral: number; negative: number } }) {
  const total = s.positive + s.neutral + s.negative;
  if (!total) return <span className="sw-ls-none">Nothing read yet</span>;
  const parts = (["positive", "neutral", "negative"] as const).filter((k) => s[k] > 0);
  const label = parts.map((k) => `${Math.round((100 * s[k]) / total)}% ${k}`).join(", ");
  return (
    <span className="sw-ls-sent" title={label} aria-label={label}>
      {parts.map((k) => (
        <i key={k} className={`sw-ls-${k}`} style={{ flexGrow: s[k] }} />
      ))}
    </span>
  );
}

function Insights({ d }: { d: Data }) {
  const ask = useFetcher<typeof action>();
  const [question, setQuestion] = useState("");
  const i = d.insights;
  const asked = ask.state === "idle" ? ask.data : undefined;
  const send = (q: string) => {
    setQuestion(q);
    ask.submit({ intent: "ask", question: q }, { method: "post" });
  };
  return (
    <s-section heading="What people are saying">
      <s-stack gap="base">
        {i ? (
          <>
            <div className="sw-ls-headline">
              <span>AI read{d.insightsAt ? `, ${day(d.insightsAt)}` : ""}</span>
              <strong>{i.headline}</strong>
            </div>
            <div className="sw-ls-cards">
              {i.customers.length > 0 && <Card title="About you" points={i.customers} />}
              {i.competitors.length > 0 && <Card title="About your competitors" points={i.competitors.map((c) => `${c.name}: ${c.takeaway}`)} />}
              {i.opportunities.length > 0 && <Card title="Do this next" points={i.opportunities} tone="go" />}
              {i.risks.length > 0 && <Card title="Keep an eye on" points={i.risks} tone="watch" />}
            </div>
          </>
        ) : (
          <s-paragraph>Your AI read of the mentions appears here after the next check.</s-paragraph>
        )}
        {d.writer && (
          <div className="sw-ls-ask">
            <s-stack direction="inline" gap="small" alignItems="end">
              <div style={{ flex: "1 1 320px" }}>
                <s-text-field label="Ask about the last month's mentions" placeholder="What do people say about delivery?" value={question} onInput={(e) => setQuestion(e.currentTarget.value)} />
              </div>
              <s-button variant="primary" loading={ask.state !== "idle"} disabled={question.trim().length < 4} onClick={() => send(question)}>
                Ask
              </s-button>
            </s-stack>
            <div className="sw-ls-chips">
              {QUESTIONS.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} disabled={ask.state !== "idle"}>
                  {q}
                </button>
              ))}
            </div>
            {asked && "error" in asked && <s-banner tone="warning">{asked.error}</s-banner>}
            {asked && "answer" in asked && (
              <div className="sw-ls-answer">
                <p>{asked.answer}</p>
                {asked.examples.length > 0 && (
                  <ul>
                    {asked.examples.map((e) => (
                      <li key={e.url}>
                        <span className={`sw-ls-dot sw-ls-${e.sentiment ?? "neutral"}`} aria-hidden />
                        <a href={e.url} target="_blank" rel="noreferrer">
                          {e.summary ?? e.title ?? e.url}
                        </a>
                        <span className="sw-ls-src"> {SOURCE_NAME[e.source] ?? e.source}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </s-stack>
    </s-section>
  );
}

function Card({ title, points, tone }: { title: string; points: string[]; tone?: "go" | "watch" }) {
  return (
    <div className={`sw-ls-card${tone ? ` sw-ls-${tone}` : ""}`}>
      <h3>{title}</h3>
      <ul>
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

// Net sentiment each week for the shop and each competitor, on one -100 to +100 scale.
function TrendChart({ d, brands, colorOf }: { d: Data; brands: Topic[]; colorOf: Map<string, string> }) {
  const [hover, setHover] = useState<number | null>(null);
  const lines = brands.filter((t) => t.trend.filter((w) => w.net != null).length > 0);
  const weeks = d.weeks;
  if (!lines.length) return null;
  const W = 720;
  const H = 240;
  const pad = { l: 44, r: lines.length <= 4 ? 110 : 16, t: 12, b: 28 };
  const x = (i: number) => pad.l + (i / (weeks.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((100 - v) / 200) * (H - pad.t - pad.b);
  const every = Math.ceil(weeks.length / 6);
  const labels = lines
    .map((t) => {
      const i = t.trend.reduce((last, w, j) => (w.net != null ? j : last), -1);
      return { id: t.id, i, y: y(t.trend[i].net ?? 0) + 4 };
    })
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 14);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (weeks.length - 1));
    setHover(i >= 0 && i < weeks.length ? i : null);
  };
  const short = (t: Topic) => (t.kind === "brand" ? "You" : t.name.length > 13 ? `${t.name.slice(0, 12)}…` : t.name);
  return (
    <s-section heading="Sentiment over time">
      <s-stack gap="small">
        <s-paragraph>Net sentiment each week: the share of positive mentions less the share of negative ones. Weeks with fewer than three mentions are left out.</s-paragraph>
        <s-stack direction="inline" gap="base">
          {lines.map((t) => (
            <s-stack key={t.id} direction="inline" gap="small-200" alignItems="center">
              <span style={{ width: 12, height: 3, borderRadius: 2, background: colorOf.get(t.id), display: "inline-block" }} />
              <s-text>{t.kind === "brand" ? `${t.name} (you)` : t.name}</s-text>
            </s-stack>
          ))}
        </s-stack>
        <div style={{ position: "relative" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Net sentiment each week for you and each competitor" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            {[100, 50, 0, -50, -100].map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#b5b5b5" : "#ececec"} strokeWidth={1} />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#616161">
                  {signed(t)}
                </text>
              </g>
            ))}
            {weeks.map((w, i) =>
              (i % every === 0 && weeks.length - 1 - i >= every) || i === weeks.length - 1 ? (
                <text key={w} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#616161">
                  {i === weeks.length - 1 ? "This week" : day(w)}
                </text>
              ) : null,
            )}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#8a8a8a" strokeWidth={1} />}
            {lines.map((t) => {
              // Gaps break the line rather than joining across weeks with too little to go on.
              const runs: string[][] = [[]];
              t.trend.forEach((w, i) => (w.net == null ? runs.push([]) : runs[runs.length - 1].push(`${x(i)},${y(w.net)}`)));
              const label = labels.find((l) => l.id === t.id)!;
              const color = colorOf.get(t.id)!;
              return (
                <g key={t.id}>
                  {runs.map((pts, k) =>
                    pts.length > 1 ? (
                      <polyline key={k} points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    ) : pts.length === 1 ? (
                      <circle key={k} cx={pts[0].split(",")[0]} cy={pts[0].split(",")[1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
                    ) : null,
                  )}
                  {lines.length <= 4 && label.i >= 0 && (
                    <text x={x(label.i) + 8} y={label.y} fontSize={12} fill="#303030">
                      {short(t)}
                    </text>
                  )}
                  {hover != null && t.trend[hover].net != null && <circle cx={x(hover)} cy={y(t.trend[hover].net!)} r={4} fill={color} stroke="#fff" strokeWidth={2} />}
                </g>
              );
            })}
          </svg>
          {hover != null && (
            <div className="sw-ls-tip" style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}>
              <strong>Week of {day(weeks[hover])}</strong>
              {lines.map((t) => {
                const w = t.trend[hover];
                return (
                  <div key={t.id}>
                    <i style={{ background: colorOf.get(t.id) }} />
                    {t.kind === "brand" ? "You" : t.name}: <b>{w.net == null ? "–" : signed(w.net)}</b>
                    <span>
                      {" "}
                      ({w.count} {w.count === 1 ? "mention" : "mentions"})
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </s-stack>
    </s-section>
  );
}

function Topics({ d }: { d: Data }) {
  const add = useFetcher<typeof action>();
  const suggest = useFetcher<typeof action>();
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const keywords = d.topics.filter((t) => t.kind === "keyword");
  const addError = add.state === "idle" && add.data && "error" in add.data ? add.data.error : null;
  const suggestData = suggest.state === "idle" ? suggest.data : undefined;
  const ideas = suggestData && "keywords" in suggestData ? suggestData.keywords.filter((k) => !picked.includes(k) && !keywords.some((t) => t.name.toLowerCase() === k.toLowerCase())) : [];
  const full = keywords.length >= d.maxKeywords;
  return (
    <s-section heading="What you listen for">
      <s-stack gap="base">
        <s-paragraph>
          Your shop and your competitors are listened for by name and website. Change the words if people call them something else. Add keywords for the things you
          sell, so you hear what shoppers say even when nobody names a brand.
        </s-paragraph>
        <div className="sw-ls-topics">
          {d.topics.map((t) => (
            <TopicRow key={t.id} t={t} />
          ))}
        </div>
        {!d.topics.length && <s-paragraph>Nothing to listen for yet. Add a keyword below, or add competitors on the Competitors page.</s-paragraph>}
        {full ? (
          <s-text color="subdued">That&apos;s the most keywords. Delete one to add another.</s-text>
        ) : (
          <s-stack gap="small">
            <s-stack direction="inline" gap="small" alignItems="end">
              <div style={{ flex: "1 1 320px" }}>
                <s-text-field
                  label={`Add a keyword (${keywords.length} of ${d.maxKeywords})`}
                  placeholder="biodegradable packaging"
                  details="Separate other ways of saying it with commas."
                  value={keyword}
                  onInput={(e) => setKeyword(e.currentTarget.value)}
                />
              </div>
              <s-button
                loading={add.state !== "idle"}
                disabled={!keyword.trim()}
                onClick={() => {
                  add.submit({ intent: "add", keyword }, { method: "post" });
                  setKeyword("");
                }}
              >
                Add
              </s-button>
              {d.writer && (
                <s-button variant="secondary" loading={suggest.state !== "idle"} onClick={() => suggest.submit({ intent: "suggest" }, { method: "post" })}>
                  Suggest keywords
                </s-button>
              )}
            </s-stack>
            {addError && <s-banner tone="warning">{addError}</s-banner>}
            {suggestData && "error" in suggestData && <s-banner tone="warning">{suggestData.error}</s-banner>}
            {ideas.length > 0 && (
              <div className="sw-ls-ideas">
                <span>Suggested for your shop:</span>
                {ideas.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setPicked([...picked, k]);
                      add.submit({ intent: "add", keyword: k }, { method: "post" });
                    }}
                  >
                    + {k}
                  </button>
                ))}
              </div>
            )}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

function TopicRow({ t }: { t: Topic }) {
  const act = useFetcher<typeof action>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.terms.join(", "));
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;
  if (act.state !== "idle" && act.formData?.get("intent") === "delete") return null;
  return (
    <div className="sw-ls-topic">
      <div className="sw-ls-tmain">
        <s-badge tone={t.kind === "brand" ? "info" : t.kind === "competitor" ? "warning" : undefined}>{t.kind === "brand" ? "You" : t.kind === "competitor" ? "Competitor" : "Keyword"}</s-badge>
        <strong>{t.name}</strong>
        <span className="sw-ls-terms">{t.terms.map((w) => `“${w}”`).join(" · ")}</span>
        <span className="sw-ls-tstat">{t.month === 1 ? "1 mention" : `${t.month} mentions`} in 30 days</span>
        <span>
          <s-button variant="tertiary" onClick={() => setEditing(!editing)}>
            Change words
          </s-button>
          {t.kind === "keyword" && (
            <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "delete", id: t.id }, { method: "post" })}>
              Delete
            </s-button>
          )}
        </span>
      </div>
      {editing && (
        <s-stack direction="inline" gap="small" alignItems="end">
          <div style={{ flex: "1 1 320px" }}>
            <s-text-field label="Words to listen for, separated by commas" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} details="New words start this topic's mentions again." />
          </div>
          <s-button
            variant="primary"
            onClick={() => {
              act.submit({ intent: "edit", id: t.id, terms: draft }, { method: "post" });
              setEditing(false);
            }}
          >
            Save
          </s-button>
        </s-stack>
      )}
      {error && <s-banner tone="warning">{error}</s-banner>}
    </div>
  );
}

function Feed({ d }: { d: Data }) {
  const [params, setParams] = useSearchParams();
  const [shown, setShown] = useState(20);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { preventScrollReset: true });
  };
  return (
    <s-section heading="Mentions">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <s-select label="About" value={params.get("topic") ?? ""} onChange={(e) => set("topic", e.currentTarget.value)}>
            <s-option value="">Everything</s-option>
            {d.topics.map((t) => (
              <s-option key={t.id} value={t.id}>
                {t.kind === "brand" ? `${t.name} (you)` : t.name}
              </s-option>
            ))}
          </s-select>
          <s-select label="Where" value={params.get("source") ?? ""} onChange={(e) => set("source", e.currentTarget.value)}>
            <s-option value="">Everywhere</s-option>
            {SOURCES.map((s) => (
              <s-option key={s.key} value={s.key}>
                {s.name}
              </s-option>
            ))}
          </s-select>
          <s-select label="Feeling" value={params.get("sentiment") ?? ""} onChange={(e) => set("sentiment", e.currentTarget.value)}>
            <s-option value="">Any</s-option>
            <s-option value="positive">Positive</s-option>
            <s-option value="neutral">Neutral</s-option>
            <s-option value="negative">Negative</s-option>
          </s-select>
        </s-grid>
        {d.feed.length === 0 && <s-paragraph>No mentions match.</s-paragraph>}
        <div className="sw-ls-feed">
          {d.feed.slice(0, shown).map((m) => (
            <article key={m.id} className={`sw-ls-post sw-ls-b-${m.sentiment ?? "none"}`}>
              <div className="sw-ls-meta">
                <span className="sw-ls-srcname">{SOURCE_NAME[m.source] ?? m.source}</span>
                {m.place && <span>{m.place}</span>}
                <span>{day(m.at)}</span>
                {m.engagement != null && m.engagement > 0 && <span>{compact(m.engagement)} {m.source === "reddit" ? "upvotes" : m.source === "web" ? "likes" : "views"}</span>}
                <span className="sw-ls-about">About {m.topic}</span>
              </div>
              <a href={m.url} target="_blank" rel="noreferrer" className="sw-ls-title">
                {m.title || m.text.slice(0, 120) || m.url}
              </a>
              {m.summary ? <p>{m.summary}</p> : m.text && m.title ? <p>{m.text.slice(0, 240)}</p> : null}
              <div className="sw-ls-tags">
                {m.sentiment ? <span className={`sw-ls-feel sw-ls-f-${m.sentiment}`}>{FEELING[m.sentiment]}</span> : <span className="sw-ls-feel">Not read yet</span>}
                {m.themes.map((t) => (
                  <span key={t} className="sw-ls-tag">
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
        {d.feed.length > shown && (
          <s-button variant="secondary" onClick={() => setShown(shown + 20)}>
            Show more
          </s-button>
        )}
      </s-stack>
    </s-section>
  );
}

const CSS = `
.sw-up { color: #0f6e45; } .sw-down { color: #c4291c; }
.sw-ls-headline { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border-radius: 12px; background: linear-gradient(135deg, #f1f6fe, #f7f3fd); border: 1px solid #d6e2f5; }
.sw-ls-headline span { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #5b5bd6; }
.sw-ls-headline strong { font-size: 17px; line-height: 1.4; color: #1f2a44; }
.sw-ls-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.sw-ls-card { padding: 12px 14px; border: 1px solid #e3e3e3; border-radius: 12px; background: #fff; }
.sw-ls-card h3 { margin: 0 0 6px; font-size: 13px; color: #303030; }
.sw-ls-card ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: #303030; }
.sw-ls-card li + li { margin-top: 6px; }
.sw-ls-go { border-color: #b8e3cf; background: #f5fbf8; }
.sw-ls-watch { border-color: #f3d9a4; background: #fffaf0; }
.sw-ls-ask { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid #f1f1f1; }
.sw-ls-chips, .sw-ls-ideas { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: #616161; }
.sw-ls-chips button, .sw-ls-ideas button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 999px; border: 1px solid #d6d6f5; background: #f6f6fe; color: #3f3fa8; cursor: pointer; }
.sw-ls-chips button:hover, .sw-ls-ideas button:hover { background: #ececfd; }
.sw-ls-chips button:disabled { opacity: .6; cursor: default; }
.sw-ls-answer { padding: 12px 14px; border-radius: 10px; background: #f7f7f7; font-size: 13px; line-height: 1.55; color: #303030; }
.sw-ls-answer p { margin: 0; white-space: pre-wrap; }
.sw-ls-answer ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.sw-ls-answer a { color: #2a78d6; }
.sw-ls-src { color: #8a8a8a; font-size: 12px; }
.sw-ls-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.sw-ls-voice { display: flex; flex-direction: column; font-size: 13px; color: #303030; }
.sw-ls-vhead, .sw-ls-vrow { display: grid; grid-template-columns: minmax(110px, 1.4fr) 80px minmax(120px, 1.6fr) minmax(120px, 1.6fr) 44px; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f1f1; }
.sw-ls-vhead { font-size: 12px; color: #616161; padding-top: 0; }
.sw-ls-vname { display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-ls-vname i { flex: none; width: 10px; height: 10px; border-radius: 3px; }
.sw-ls-you .sw-ls-vname { font-weight: 600; }
.sw-ls-vrow em { font-style: normal; font-size: 11px; margin-left: 6px; }
.sw-ls-share { display: flex; align-items: center; gap: 8px; }
.sw-ls-share b { font-weight: 500; font-variant-numeric: tabular-nums; min-width: 32px; text-align: right; }
.sw-ls-track { flex: 1; height: 10px; border-radius: 4px; background: #f1f1f1; overflow: hidden; }
.sw-ls-track i { display: block; height: 100%; border-radius: 4px; }
.sw-ls-net { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.sw-ls-sent { display: flex; gap: 2px; height: 10px; min-width: 80px; }
.sw-ls-sent i { display: block; min-width: 4px; border-radius: 4px; }
.sw-ls-positive { background: #1baf7a; } .sw-ls-neutral { background: #c9c9c9; } .sw-ls-negative { background: #e5484d; }
.sw-ls-none { font-size: 12px; color: #8a8a8a; }
.sw-ls-tip { position: absolute; top: 8px; background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 12px rgba(0,0,0,.08); font-size: 12px; pointer-events: none; white-space: nowrap; display: flex; flex-direction: column; gap: 3px; color: #303030; }
.sw-ls-tip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
.sw-ls-tip span { color: #8a8a8a; }
.sw-ls-themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.sw-ls-theme { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid #e3e3e3; border-radius: 12px; }
.sw-ls-ttop { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.sw-ls-ttop strong { font-size: 14px; color: #303030; text-transform: capitalize; }
.sw-ls-tcount { font-size: 12px; color: #616161; }
.sw-ls-tcount em { font-style: normal; }
.sw-ls-topics { display: flex; flex-direction: column; }
.sw-ls-topic { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-bottom: 1px solid #f1f1f1; }
.sw-ls-tmain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 13px; }
.sw-ls-tmain strong { color: #303030; }
.sw-ls-terms { color: #616161; flex: 1 1 200px; }
.sw-ls-tstat { color: #8a8a8a; font-size: 12px; }
.sw-ls-feed { display: flex; flex-direction: column; gap: 10px; }
.sw-ls-post { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid #e3e3e3; border-left-width: 4px; border-radius: 10px; font-size: 13px; color: #303030; }
.sw-ls-b-positive { border-left-color: #1baf7a; } .sw-ls-b-negative { border-left-color: #e5484d; } .sw-ls-b-neutral, .sw-ls-b-none { border-left-color: #c9c9c9; }
.sw-ls-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: #616161; }
.sw-ls-srcname { font-weight: 600; color: #4a4a4a; }
.sw-ls-about { margin-left: auto; color: #8a8a8a; }
.sw-ls-title { font-weight: 600; color: #1f5199; text-decoration: none; }
.sw-ls-title:hover { text-decoration: underline; }
.sw-ls-post p { margin: 0; line-height: 1.5; color: #4a4a4a; }
.sw-ls-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sw-ls-feel, .sw-ls-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #f1f1f1; color: #4a4a4a; }
.sw-ls-f-positive { background: #e3f6ee; color: #0f6e45; } .sw-ls-f-negative { background: #fde8e8; color: #b42318; }
@media (max-width: 640px) { .sw-ls-vhead { display: none; } .sw-ls-vrow { grid-template-columns: 1fr 1fr; } }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
