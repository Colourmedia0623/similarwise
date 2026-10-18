import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { MAX_KEYWORDS, addFromGap, addKeywords, rankOverview, removeKeyword, serpClient, startRankCheck } from "../lib/ranks/ranks.server";

// Rank tracker: where the shop ranks on Google for the searches it chooses,
// checked every day, next to its competitors.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: serpClient() != null, max: MAX_KEYWORDS, ...(await rankOverview(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "add") return { intent, ...(await addKeywords(shop, String(form.get("keywords") ?? ""))) };
  if (intent === "gap") return { intent, ...(await addFromGap(shop)) };
  if (intent === "check") return { intent, ...(await startRankCheck(shop)) };
  if (intent === "remove") {
    await removeKeyword(shop, String(form.get("id") ?? ""));
    return { intent, ok: true as const };
  }
  return { error: "Unknown action" };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const place = (p: number | null, depth: number) => (p == null ? `Not in top ${depth}` : `#${p}`);

function Change({ v }: { v: number | null }) {
  if (v == null || v === 0) return <s-text color="subdued">–</s-text>;
  return <s-text tone={v > 0 ? "success" : "critical"}>{`${v > 0 ? "↑" : "↓"} ${Math.abs(v)}`}</s-text>;
}

// How many tracked searches the shop is in Google's top 10 for, on each check.
function TopTenChart({ trend }: { trend: Data["trend"] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (trend.length < 2) return null;
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 16, t: 12, b: 28 };
  const top = Math.max(4, ...trend.map((t) => t.top10));
  const x = (i: number) => pad.l + (i / (trend.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = [0, 0.5, 1].map((f) => Math.round(f * top));
  const every = Math.ceil(trend.length / 6);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (trend.length - 1));
    setHover(i >= 0 && i < trend.length ? i : null);
  };
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tracked searches you rank in Google's top 10 for, by day" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e3e3e3" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#616161">
              {t}
            </text>
          </g>
        ))}
        {trend.map((t, i) =>
          i % every === 0 ? (
            <text key={t.at} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#616161">
              {day(t.at)}
            </text>
          ) : null,
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#8a8a8a" strokeWidth={1} />}
        <polyline points={trend.map((t, i) => `${x(i)},${y(t.top10)}`).join(" ")} fill="none" stroke="#2a78d6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <circle cx={x(hover)} cy={y(trend[hover].top10)} r={4} fill="#2a78d6" stroke="#fff" strokeWidth={2} />}
      </svg>
      {hover != null && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: `${(x(hover) / W) * 100}%`,
            transform: x(hover) > W / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            background: "#fff",
            border: "1px solid #e3e3e3",
            borderRadius: 8,
            padding: "8px 10px",
            boxShadow: "0 4px 12px rgba(0,0,0,.08)",
            fontSize: 12,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{day(trend[hover].at)}</div>
          <div>Top 3: {trend[hover].top3}</div>
          <div>Top 10: {trend[hover].top10}</div>
          <div>Top 30: {trend[hover].ranked}</div>
        </div>
      )}
    </div>
  );
}

export default function Ranks() {
  const d = useLoaderData<typeof loader>();
  const add = useFetcher<typeof action>();
  const gap = useFetcher<typeof action>();
  const check = useFetcher<typeof action>();
  const remove = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [text, setText] = useState("");
  const checking = d.running || (check.state !== "idle" && check.formData?.get("intent") === "check");
  const latest = d.trend[d.trend.length - 1];
  const message = (f: typeof add) => (f.state === "idle" && f.data ? ("error" in f.data ? { tone: "warning" as const, text: f.data.error } : "added" in f.data ? { tone: "success" as const, text: f.data.added ? `Added ${f.data.added} ${f.data.added === 1 ? "search" : "searches"}.${f.data.skipped ? ` ${f.data.skipped} more didn't fit.` : ""}` : "Those searches are tracked already." } : null) : null);
  const addMsg = message(add) ?? message(gap);
  const checkError = check.state === "idle" && check.data && "error" in check.data ? check.data.error : null;

  // Results come in over a minute or two, so keep looking while a check runs.
  useEffect(() => {
    if (!d.running) return;
    const t = setInterval(() => revalidator.revalidate(), 10_000);
    return () => clearInterval(t);
  }, [d.running, revalidator]);

  return (
    <s-page heading="Rank tracker">
      {d.on && (
        <s-button slot="primary-action" variant="primary" loading={checking} disabled={!d.keywords.length || !d.domain} onClick={() => check.submit({ intent: "check" }, { method: "post" })}>
          Check now
        </s-button>
      )}
      {!d.on && <s-banner tone="info">The rank tracker isn&apos;t switched on for this app yet.</s-banner>}
      {!d.domain && (
        <s-banner tone="warning">
          Add your store&apos;s website on the <s-link href="/app/keywords">Keyword gap</s-link> page so your rankings can be found.
        </s-banner>
      )}

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Choose the Google searches that matter to you. Every day SimilarWise looks them up as a shopper in {d.market} would, and records where
            {d.domain ? ` ${d.domain}` : " your store"} and each competitor rank in the top {d.depth}.
          </s-paragraph>
          {checking && <s-banner tone="info">Checking Google for each search. This takes a minute or two; the page updates by itself.</s-banner>}
          {checkError && <s-banner tone="warning">{checkError}</s-banner>}
          {d.error && !checking && <s-banner tone="warning">{d.error}</s-banner>}
          {d.checkedAt && !checking && <s-text color="subdued">Last checked {day(d.checkedAt)}. Checked again every day.</s-text>}
        </s-stack>
      </s-section>

      {latest && (
        <s-section heading="Your rankings">
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
              {[
                { label: "In the top 3", v: latest.top3 },
                { label: "In the top 10", v: latest.top10 },
                { label: `In the top ${d.depth}`, v: latest.ranked },
              ].map((t) => (
                <s-box key={t.label} padding="base" background="subdued" borderRadius="base">
                  <s-stack gap="small-200">
                    <s-text color="subdued">{t.label}</s-text>
                    <s-heading>{`${t.v} of ${d.keywords.length}`}</s-heading>
                  </s-stack>
                </s-box>
              ))}
            </s-grid>
            {d.trend.length > 1 && (
              <s-stack gap="small">
                <s-text type="strong">Searches you rank in the top 10 for</s-text>
                <TopTenChart trend={d.trend} />
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section heading={`Tracked searches (${d.keywords.length} of ${d.max})`}>
        <s-stack gap="base">
          {addMsg && <s-banner tone={addMsg.tone}>{addMsg.text}</s-banner>}
          <s-text-area label="Add searches" details="One per line, like magnetic gift boxes." rows={3} value={text} onInput={(e) => setText(e.currentTarget.value)} />
          <s-stack direction="inline" gap="small">
            <s-button loading={add.state !== "idle"} disabled={!text.trim()} onClick={() => {
                add.submit({ intent: "add", keywords: text }, { method: "post" });
                setText("");
              }}>
              Add
            </s-button>
            <s-button variant="secondary" loading={gap.state !== "idle"} onClick={() => gap.submit({ intent: "gap" }, { method: "post" })}>
              Add the biggest searches from the keyword gap
            </s-button>
          </s-stack>

          {d.keywords.length > 0 && (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Search</s-table-header>
                <s-table-header>You</s-table-header>
                <s-table-header>Last 7 days</s-table-header>
                {d.competitors.map((c) => (
                  <s-table-header key={c.id}>{c.name}</s-table-header>
                ))}
                <s-table-header>Your page</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.keywords.map((k) => (
                  <s-table-row key={k.id}>
                    <s-table-cell>{k.keyword}</s-table-cell>
                    <s-table-cell>{!k.checked ? <s-text color="subdued">Not checked yet</s-text> : k.error ? <s-text tone="critical">Couldn&apos;t check</s-text> : place(k.position, d.depth)}</s-table-cell>
                    <s-table-cell>
                      <Change v={k.change} />
                    </s-table-cell>
                    {k.competitors.map((p, i) => (
                      <s-table-cell key={d.competitors[i].id}>{k.checked && !k.error ? (p == null ? "–" : `#${p}`) : ""}</s-table-cell>
                    ))}
                    <s-table-cell>
                      {k.url ? (
                        <s-link href={k.url} target="_blank">
                          {new URL(k.url).pathname || "/"}
                        </s-link>
                      ) : (
                        ""
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-button variant="tertiary" tone="critical" accessibilityLabel={`Stop tracking ${k.keyword}`} onClick={() => remove.submit({ intent: "remove", id: k.id }, { method: "post" })}>
                        Remove
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
