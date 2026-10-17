import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { compact, formatPrice } from "../lib/format";
import { trafficClient } from "../lib/traffic/dataforseo.server";
import { refreshTraffic } from "../lib/traffic/refresh.server";
import { channelsOverview, refreshOwnTraffic } from "../lib/traffic/channels.server";
import { CHANNEL_LABEL, type Channel } from "../lib/traffic/channels";

// Marketing channels: Google search visits, organic and from ads, for the
// shop and each competitor, and the other channels each is set up for.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: trafficClient() != null, ...(await channelsOverview(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await refreshOwnTraffic(session.shop, { force: true }).catch((err) => console.error("Couldn't refresh own traffic", err));
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
  const { on, market, ownDomain, sites } = useLoaderData<typeof loader>();
  const refresh = useFetcher();
  const measured = sites.some((s) => s.organic != null);
  return (
    <s-page heading="Marketing channels">
      {on && sites.length > 0 && (
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
              <s-paragraph tone="neutral">
                Estimates from Google rankings and ads. Direct, email, referral and social visits aren&apos;t measured yet.
              </s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading="Channels they use">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Site</s-table-header>
                <s-table-header format="numeric">Google search</s-table-header>
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
