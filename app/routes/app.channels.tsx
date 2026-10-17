import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { branded, compact, formatPrice } from "../lib/format";
import { trafficClient } from "../lib/traffic/dataforseo.server";
import { refreshTraffic } from "../lib/traffic/refresh.server";
import { channelsOverview, refreshOwnTraffic, refreshShopSources } from "../lib/traffic/channels.server";
import { sourcesClient } from "../lib/traffic/sources.server";
import { SOURCES, SOURCE_LABEL, type Source } from "../lib/traffic/sources";
import { CHANNEL_LABEL, type Channel } from "../lib/traffic/channels";

// Marketing channels: Google search visits, organic and from ads, for the
// shop and each competitor, and the other channels each is set up for.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: trafficClient() != null, sourcesOn: sourcesClient() != null, ...(await channelsOverview(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await refreshOwnTraffic(session.shop, { force: true }).catch((err) => console.error("Couldn't refresh own traffic", err));
  await refreshShopSources(session.shop).catch((err) => console.error("Couldn't refresh traffic sources", err));
  const competitors = await db.competitor.findMany({ where: { shop: session.shop }, select: { id: true } });
  for (const c of competitors) await refreshTraffic(c.id, { force: true });
  return { ok: true };
};

type Site = ReturnType<typeof useLoaderData<typeof loader>>["sites"][number];

const ORGANIC = "#2a78d6";
const PAID = "#eb6834";

function SearchChart({ sites }: { sites: Site[] }) {
  const rows = sites.filter((s) => s.organic != null);
  const max = Math.max(1, ...rows.flatMap((s) => [s.organic ?? 0, s.paid ?? 0]));
  const labelW = 200;
  const barW = 420;
  const rowH = 44;
  const width = labelW + barW + 60;
  const height = rows.length * rowH + 8;
  const w = (n: number) => Math.max(n > 0 ? 3 : 0, (n / max) * barW);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Monthly visits from Google search and Google ads, by site" style={{ maxWidth: width }}>
      {rows.map((s, i) => {
        const y = i * rowH + 4;
        const bar = (n: number, dy: number, color: string, label: string) => (
          <g>
            <title>{`${s.name}: ${n.toLocaleString("en")} ${label} a month`}</title>
            <rect x={labelW} y={y + dy - 4} width={barW + 60} height={18} fill="transparent" />
            <rect x={labelW} y={y + dy} width={w(n)} height={10} rx={2} fill={color} />
            <text x={labelW + w(n) + 6} y={y + dy + 9} fontSize={12} fill="#616161">
              {compact(n)}
            </text>
          </g>
        );
        return (
          <g key={s.id}>
            <text x={0} y={y + 16} fontSize={13} fontWeight={s.you ? 600 : 400} fill="#303030">
              {s.name.length > 28 ? `${s.name.slice(0, 27)}…` : s.name}
            </text>
            {bar(s.organic ?? 0, 4, ORGANIC, "visits from Google search")}
            {bar(s.paid ?? 0, 18, PAID, "visits from Google ads")}
          </g>
        );
      })}
    </svg>
  );
}

// Fixed order, one hue per channel (validated categorical palette).
const SOURCE_COLOR: Record<Source, string> = {
  direct: "#2a78d6",
  search: "#eb6834",
  paidSearch: "#1baf7a",
  social: "#eda100",
  referrals: "#e87ba4",
  email: "#008300",
  display: "#6250d6",
  other: "#e34948",
};

const pct = (n: number) => `${n >= 0.095 ? Math.round(n * 100) : (n * 100).toFixed(1).replace(/\.0$/, "")}%`;

const HIDDEN = "#e3e3e3";

function SourcesChart({ sites }: { sites: Site[] }) {
  const rows = sites.filter((s) => s.traffic && Object.keys(s.traffic.sources).length);
  const labelW = 200;
  const barW = 460;
  const rowH = 34;
  const width = labelW + barW;
  return (
    <svg viewBox={`0 0 ${width} ${rows.length * rowH}`} width="100%" role="img" aria-label="Share of visits by channel, by site" style={{ maxWidth: width }}>
      {rows.map((s, i) => {
        const shares = s.traffic!.sources;
        // Shares add up to under 1 when Similarweb hides some channels; the
        // rest is drawn grey rather than stretched.
        const total = Math.max(SOURCES.reduce((t, k) => t + (shares[k] ?? 0), 0), 1);
        const hidden = 1 - SOURCES.reduce((t, k) => t + (shares[k] ?? 0), 0) / total;
        let x = labelW;
        const y = i * rowH + 6;
        return (
          <g key={s.id}>
            <text x={0} y={y + 14} fontSize={13} fontWeight={s.you ? 600 : 400} fill="#303030">
              {s.name.length > 28 ? `${s.name.slice(0, 27)}…` : s.name}
            </text>
            {SOURCES.map((k) => {
              const v = (shares[k] ?? 0) / total;
              if (v <= 0) return null;
              const w = v * barW;
              const seg = (
                <g key={k}>
                  <title>{`${s.name}: ${SOURCE_LABEL[k]} ${pct(v)}`}</title>
                  <rect x={x} y={y} width={Math.max(w - 2, 1)} height={20} rx={2} fill={SOURCE_COLOR[k]} />
                  {w >= 34 && (
                    <text x={x + 5} y={y + 14} fontSize={11} fill={k === "social" || k === "referrals" ? "#1a1a1a" : "#ffffff"}>
                      {pct(v)}
                    </text>
                  )}
                </g>
              );
              x += w;
              return seg;
            })}
            {hidden > 0.005 && (
              <g>
                <title>{`${s.name}: hidden by Similarweb ${pct(hidden)}`}</title>
                <rect x={x} y={y} width={Math.max(hidden * barW - 2, 1)} height={20} rx={2} fill={HIDDEN} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

function Legend() {
  const item = (color: string, label: string) => (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: color }} />
      <s-text>{label}</s-text>
    </s-stack>
  );
  return (
    <s-stack direction="inline" gap="base">
      {item(ORGANIC, "Google search")}
      {item(PAID, "Google ads")}
    </s-stack>
  );
}

const CHANNELS: Channel[] = ["social", "email", "otherAds"];

export default function Channels() {
  const { on, sourcesOn, market, ownDomain, sites } = useLoaderData<typeof loader>();
  const refresh = useFetcher();
  const measured = sites.some((s) => s.organic != null);
  return (
    <s-page heading="Marketing channels">
      {(on || sourcesOn) && sites.length > 0 && (
        <s-button slot="primary-action" loading={refresh.state !== "idle"} onClick={() => refresh.submit({}, { method: "post" })}>
          Refresh
        </s-button>
      )}
      {!on && <s-banner tone="info">Search data isn&apos;t switched on for this app yet.</s-banner>}
      {sites.length === 0 ? (
        <s-section>
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section heading="Where their visits come from">
            <s-stack gap="base">
              {!sourcesOn ? (
                <s-paragraph>Traffic sources aren&apos;t switched on for this app yet.</s-paragraph>
              ) : sites.some((s) => s.traffic && Object.keys(s.traffic.sources).length) ? (
                <>
                  <s-stack direction="inline" gap="base">
                    {SOURCES.map((k) => (
                      <s-stack key={k} direction="inline" gap="small-200" alignItems="center">
                        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: SOURCE_COLOR[k] }} />
                        <s-text>{SOURCE_LABEL[k]}</s-text>
                      </s-stack>
                    ))}
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: HIDDEN }} />
                      <s-text>Not shown by Similarweb</s-text>
                    </s-stack>
                  </s-stack>
                  <SourcesChart sites={sites} />
                </>
              ) : (
                <s-paragraph>No traffic sources yet. Press Refresh to fetch them.</s-paragraph>
              )}
              {sourcesOn && (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Site</s-table-header>
                    <s-table-header format="numeric">Visits a month</s-table-header>
                    <s-table-header>Top countries</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {sites.map((s) => (
                      <s-table-row key={s.id}>
                        <s-table-cell>{s.you ? `You (${s.domain})` : s.name}</s-table-cell>
                        <s-table-cell>{s.traffic?.visits ? compact(s.traffic.visits) : "–"}</s-table-cell>
                        <s-table-cell>
                          {s.traffic?.countries.length
                            ? s.traffic.countries
                                .slice(0, 3)
                                .map((c) => `${countryName(c.code)} ${pct(c.share)}`)
                                .join(", ")
                            : (s.traffic?.error ?? (s.traffic ? "Not shown by Similarweb" : "Not checked yet"))}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
              <s-paragraph tone="neutral">Similarweb&apos;s estimates, worldwide, refreshed weekly. Sites with few visitors may have none.</s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading={`Visits from Google a month, in ${market}`}>
            <s-stack gap="base">
              {measured ? (
                <>
                  <Legend />
                  <SearchChart sites={sites} />
                </>
              ) : (
                <s-paragraph>No search numbers yet. Press Refresh to fetch them.</s-paragraph>
              )}
              {!ownDomain && (
                <s-paragraph>
                  To see your own site here, enter your website on the <s-link href="/app/keywords">Keyword gap</s-link> page.
                </s-paragraph>
              )}
              <s-paragraph tone="neutral">Estimates from Google rankings and ads, for the shop&apos;s market.</s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading="Channels they use">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Site</s-table-header>
                <s-table-header format="numeric">Google search</s-table-header>
                <s-table-header format="numeric">Top 3 keywords</s-table-header>
                <s-table-header format="numeric">Searches for their name</s-table-header>
                <s-table-header format="numeric">Google ads</s-table-header>
                <s-table-header format="numeric">Ad spend a month</s-table-header>
                {CHANNELS.map((ch) => (
                  <s-table-header key={ch}>{CHANNEL_LABEL[ch]}</s-table-header>
                ))}
              </s-table-header-row>
              <s-table-body>
                {sites.map((s) => (
                  <s-table-row key={s.id}>
                    <s-table-cell>{s.you ? `You (${s.domain})` : s.name}</s-table-cell>
                    <s-table-cell>{s.organic == null ? "–" : compact(s.organic)}</s-table-cell>
                    <s-table-cell>{compact(s.top3)}</s-table-cell>
                    <s-table-cell>{branded(s.branded, s.organic)}</s-table-cell>
                    <s-table-cell>
                      {s.paid == null ? "–" : compact(s.paid)}
                      {s.liveAds?.google ? ` · ${s.liveAds.google} ads` : ""}
                    </s-table-cell>
                    <s-table-cell>{s.paidCostCents == null ? "–" : formatPrice(s.paidCostCents, "USD")}</s-table-cell>
                    {CHANNELS.map((ch) => {
                      const tools = s.tools?.[ch] ?? [];
                      const ads = ch === "social" && s.liveAds ? s.liveAds.meta + s.liveAds.tiktok : 0;
                      return (
                        <s-table-cell key={ch}>
                          {s.you ? "–" : tools.length ? tools.join(", ") + (ads ? ` · ${ads} live ads` : "") : "None seen"}
                        </s-table-cell>
                      );
                    })}
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
