import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact, timeAgo } from "../lib/format";
import { engagementOverview } from "../lib/traffic/engagement.server";
import { refreshShopSources } from "../lib/traffic/channels.server";
import { sourcesClient } from "../lib/traffic/sources.server";

// Traffic and engagement: each site's monthly visits over time, and how
// visitors behave once they arrive.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: sourcesClient() != null, ...(await engagementOverview(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await refreshShopSources(session.shop, { force: true });
  return { ok: true };
};

type Site = ReturnType<typeof useLoaderData<typeof loader>>["sites"][number];

// Fixed by position (you first, then competitors in the order added), so a
// site keeps its colour.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

const duration = (s: number | null | undefined) => (s == null ? "–" : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`);
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const change = (v: number | null | undefined) => (v == null ? "–" : `${v > 0 ? "↑" : v < 0 ? "↓" : ""} ${Math.abs(Math.round(v * 100))}%`.trim());
const rank = (v: number | null | undefined, country?: string | null) => (v == null ? "–" : `#${v.toLocaleString("en")}${country ? ` in ${country}` : ""}`);

function VisitsChart({ sites }: { sites: (Site & { color: string })[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const lines = sites.filter((s) => (s.engagement?.history.length ?? 0) > 1);
  const months = [...new Set(lines.flatMap((s) => s.engagement!.history.map((h) => h.month)))].sort();
  if (lines.length === 0 || months.length < 2) return null;
  const W = 720;
  const H = 260;
  const pad = { l: 52, r: lines.length <= 4 ? 120 : 16, t: 12, b: 28 };
  const max = Math.max(1, ...lines.flatMap((s) => s.engagement!.history.map((h) => h.visits)));
  // The smallest round number at or above the highest month.
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const top = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((f) => f * mag).find((v) => v >= max) ?? 10 * mag;
  const x = (i: number) => pad.l + (i / (months.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const at = (s: Site, m: string) => s.engagement!.history.find((h) => h.month === m)?.visits ?? null;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const every = Math.ceil(months.length / 6);
  const shown = months.map((_, i) => i % every === 0);
  // End-of-line labels, nudged apart so they don't overlap.
  const labels = lines
    .map((s) => {
      const i = months.reduce((last, m, j) => (at(s, m) != null ? j : last), -1);
      return { id: s.id, i, y: y(at(s, months[i]) ?? 0) + 4 };
    })
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 14);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (months.length - 1));
    setHover(i >= 0 && i < months.length ? i : null);
  };
  return (
    <s-stack gap="small">
      <s-stack direction="inline" gap="base">
        {lines.map((s) => (
          <s-stack key={s.id} direction="inline" gap="small-200" alignItems="center">
            <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color, display: "inline-block" }} />
            <s-text>{s.you ? "You" : s.name}</s-text>
          </s-stack>
        ))}
      </s-stack>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly visits for each site" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e3e3e3" strokeWidth={1} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#616161">
                {compact(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) =>
            shown[i] ? (
              <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#616161">
                {monthLabel(m)}
              </text>
            ) : null,
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#8a8a8a" strokeWidth={1} />}
          {lines.map((s) => {
            const pts = months.flatMap((m, i) => {
              const v = at(s, m);
              return v == null ? [] : [`${x(i)},${y(v)}`];
            });
            const label = labels.find((l) => l.id === s.id)!;
            return (
              <g key={s.id}>
                <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {lines.length <= 4 && label.i >= 0 && (
                  <text x={x(label.i) + 8} y={label.y} fontSize={12} fill="#303030">
                    {s.you ? "You" : s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}
                  </text>
                )}
                {hover != null && at(s, months[hover]) != null && (
                  <circle cx={x(hover)} cy={y(at(s, months[hover])!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                )}
              </g>
            );
          })}
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
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{monthLabel(months[hover])}</div>
            {lines.map((s) => (
              <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />
                <span>{s.you ? "You" : s.name}</span>
                <span style={{ marginLeft: "auto", paddingLeft: 12, fontWeight: 600 }}>{compact(at(s, months[hover]))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </s-stack>
  );
}

export default function Traffic() {
  const { on, sites } = useLoaderData<typeof loader>();
  const refresh = useFetcher<typeof action>();
  const colored = sites.map((s, i) => ({ ...s, color: SERIES[i % SERIES.length] }));
  const read = sites.filter((s) => s.fetchedAt).map((s) => s.fetchedAt!);
  const waiting = sites.some((s) => !s.engagement && !s.error);
  return (
    <s-page heading="Traffic and engagement">
      {on && sites.length > 0 && (
        <s-button slot="primary-action" loading={refresh.state !== "idle"} onClick={() => refresh.submit({}, { method: "post" })}>
          Refresh
        </s-button>
      )}
      {!on && <s-banner tone="info">Traffic estimates aren&apos;t switched on for this app yet.</s-banner>}

      <s-section heading="Visits a month">
        {sites.length === 0 ? (
          <s-paragraph>
            Add a competitor on the <s-link href="/app/competitors">Competitors</s-link> page to see their traffic.
          </s-paragraph>
        ) : colored.some((s) => (s.engagement?.history.length ?? 0) > 1) ? (
          <VisitsChart sites={colored} />
        ) : (
          <s-paragraph>{waiting ? "No visit history yet. Press Refresh to fetch it." : "Similarweb has no visit history for these sites yet."}</s-paragraph>
        )}
      </s-section>

      {sites.length > 0 && (
        <s-section heading="How visitors behave">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Site</s-table-header>
              <s-table-header format="numeric">Visits a month</s-table-header>
              <s-table-header format="numeric">Change</s-table-header>
              <s-table-header format="numeric">Time on site</s-table-header>
              <s-table-header format="numeric">Pages per visit</s-table-header>
              <s-table-header format="numeric">Bounce rate</s-table-header>
              <s-table-header format="numeric">Global rank</s-table-header>
              <s-table-header format="numeric">Country rank</s-table-header>
              <s-table-header format="numeric">Category rank</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {sites.map((s) => {
                const e = s.engagement;
                return (
                  <s-table-row key={s.id}>
                    <s-table-cell>
                      {s.you ? `You (${s.domain})` : s.name}
                      {s.error && s.visits == null && <s-text color="subdued"> {s.error}</s-text>}
                    </s-table-cell>
                    <s-table-cell>{compact(s.visits)}</s-table-cell>
                    <s-table-cell>{change(e?.visitsChange)}</s-table-cell>
                    <s-table-cell>{duration(e?.durationSeconds)}</s-table-cell>
                    <s-table-cell>{e?.pagesPerVisit == null ? "–" : e.pagesPerVisit.toFixed(1)}</s-table-cell>
                    <s-table-cell>{pct(e?.bounceRate)}</s-table-cell>
                    <s-table-cell>{rank(e?.globalRank)}</s-table-cell>
                    <s-table-cell>{rank(e?.countryRank, e?.rankCountry)}</s-table-cell>
                    <s-table-cell>{rank(e?.categoryRank, e?.category?.replace(/_/g, " "))}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {sites.some((s) => s.engagement?.aiShare != null) && (
        <s-section heading="Visits from AI assistants">
          <s-stack gap="base">
            <s-paragraph>Shoppers who clicked through from ChatGPT, Perplexity, Gemini and other assistants, and which ones sent them.</s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Site</s-table-header>
                <s-table-header format="numeric">Share of visits</s-table-header>
                <s-table-header format="numeric">Visits a month</s-table-header>
                <s-table-header>Sent by</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {sites.map((s) => {
                  const e = s.engagement;
                  return (
                    <s-table-row key={s.id}>
                      <s-table-cell>{s.you ? `You (${s.domain})` : s.name}</s-table-cell>
                      <s-table-cell>{e?.aiShare == null ? "–" : `${(e.aiShare * 100).toFixed(e.aiShare < 0.01 ? 2 : 1)}%`}</s-table-cell>
                      <s-table-cell>{e?.aiShare == null || s.visits == null ? "–" : compact(Math.round(e.aiShare * s.visits))}</s-table-cell>
                      <s-table-cell>{e?.aiChatbots?.length ? e.aiChatbots.map((b) => `${b.name} ${pct(b.share)}`).join(", ") : "–"}</s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-stack>
        </s-section>
      )}

      <s-section>
        <s-text color="subdued">
          Similarweb&apos;s estimates for visits from every source, worldwide. Bounce rate is the share of visitors who leave after one page.
          {read.length > 0 && ` Updated ${timeAgo(read.sort()[0])}, refreshed weekly.`}
        </s-text>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
