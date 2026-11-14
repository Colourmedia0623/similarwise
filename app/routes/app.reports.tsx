import type { ReactNode } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { mailer } from "../lib/email/send.server";
import { performanceReport } from "../lib/reports/report.server";
import { reportEmail } from "../lib/reports/email.server";
import {
  REPORT_PERIODS,
  change,
  parseReportPeriod,
  roas,
  type Report,
} from "../lib/reports/report";
import {
  AD_NETWORK_NAME,
  NO_METRICS,
  addMetrics,
  formatMoney,
  type AdNetwork,
} from "../lib/paidsocial/paid";
import { NETWORK_NAME, type Network } from "../lib/social/networks";
import { EVENT_LABEL, compact } from "../lib/format";

// Reports: one printable page of how the shop is doing over a period, with
// paid social spend and return, social posts, Google Analytics and Ads,
// rankings and competitors, each against the period before. Printing it or
// saving it as a PDF uses the browser's own print dialog. Last month's report
// can also come by email on the 1st.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const period = parseReportPeriod(
    new URL(request.url).searchParams.get("period"),
  );
  const [report, settings] = await Promise.all([
    performanceReport(session.shop, period),
    db.shopSettings.findUnique({ where: { shop: session.shop } }),
  ]);
  return {
    period,
    report,
    emailOn: mailer() != null,
    email: settings?.alertEmail ?? null,
    reportOn: settings?.reportOn ?? false,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "monthly") {
    const reportOn = form.get("on") === "true";
    await db.shopSettings.upsert({
      where: { shop },
      create: { shop, reportOn },
      update: { reportOn },
    });
    return { ok: true as const, intent };
  }
  if (intent === "send") {
    const send = mailer();
    const s = await db.shopSettings.findUnique({ where: { shop } });
    if (!send || !s?.alertEmail)
      return { error: "Add your email address in Settings first." };
    const email = reportEmail(
      await performanceReport(
        shop,
        parseReportPeriod(String(form.get("period") ?? "")),
      ),
      s.alertEmail,
    );
    if (!email)
      return { error: "There's nothing to report for this period yet." };
    try {
      await send(email);
    } catch (err) {
      console.error("Report email failed", shop, err);
      return { error: "The email couldn't be sent. Try again in a minute." };
    }
    return { ok: true as const, intent, sent: s.alertEmail };
  }
  return { error: "Unknown action" };
};

// --- Formatting --------------------------------------------------------------

const whole = (v: number | null | undefined) =>
  v == null ? "–" : Math.round(v).toLocaleString("en-GB");
const times = (v: number | null) => (v == null ? "–" : `${v.toFixed(1)}×`);
const pct = (v: number | null | undefined) =>
  v == null ? "–" : `${v.toFixed(1)}%`;
const dollars = (cents: number | null | undefined) =>
  cents == null ? "–" : `$${compact(cents / 100)}`;
const dayShort = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

// Chart colours, one per channel, in a fixed order: the same colour-blind-safe set as the social calendar's reports.
const NETWORK_COLOR: Record<Network, string> = {
  facebook: "#2a78d6",
  instagram: "#eb6834",
  pinterest: "#1baf7a",
  tiktok: "#eda100",
  linkedin: "#8a4fc7",
};
const AD_COLOR: Record<AdNetwork, string> = {
  meta: "#2a78d6",
  tiktok: "#eda100",
};
const BAR = "#2a78d6";

// Which way is good for a figure: more sales is good, more spend is neither.
type Good = "up" | "down" | "neutral";

function Delta({
  now,
  before,
  good = "up",
}: {
  now: number | null | undefined;
  before: number | null | undefined;
  good?: Good;
}) {
  const c = change(now, before);
  if (c == null) return <span className="rp-delta">No earlier figure</span>;
  const up = c >= 0;
  const tone =
    good === "neutral" || Math.abs(c) < 0.5
      ? ""
      : (up ? good === "up" : good === "down")
        ? " rp-good"
        : " rp-bad";
  return (
    <span className={`rp-delta${tone}`}>
      {up ? "▲" : "▼"} {Math.abs(c).toFixed(0)}%
    </span>
  );
}

type Tile = {
  label: string;
  value: string;
  now?: number | null;
  before?: number | null;
  good?: Good;
  note?: string;
};

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    // Up to six in a row; more split into two even rows.
    <div
      className="rp-tiles"
      style={{
        gridTemplateColumns: `repeat(${tiles.length <= 6 ? tiles.length : Math.ceil(tiles.length / 2)}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((t) => (
        <div key={t.label} className="rp-tile">
          <span className="rp-tile-label">{t.label}</span>
          <strong>{t.value}</strong>
          {t.note ? (
            <span className="rp-delta">{t.note}</span>
          ) : (
            <Delta now={t.now} before={t.before} good={t.good} />
          )}
        </div>
      ))}
    </div>
  );
}

// A horizontal bar for a value, scaled to the biggest in its table.
function Bar({
  value,
  max,
  color = BAR,
  label,
}: {
  value: number;
  max: number;
  color?: string;
  label: string;
}) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <span className="rp-bar" title={label}>
      <i style={{ width: `${w}%`, background: color }} />
    </span>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="rp-section">
      <header>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rp-empty">{children}</p>;
}

// --- Sections ----------------------------------------------------------------

function Summary({ r }: { r: Report }) {
  const accounts = r.paid.filter((a) => !a.error);
  const currencies = [...new Set(accounts.map((a) => a.currency))];
  const tiles: Tile[] = [];
  if (currencies.length === 1) {
    const cur = accounts.map((a) => a.current).reduce(addMetrics, NO_METRICS);
    const prev = accounts.map((a) => a.previous).reduce(addMetrics, NO_METRICS);
    tiles.push(
      {
        label: "Social ad spend",
        value: formatMoney(cur.spend, currencies[0]),
        now: cur.spend,
        before: prev.spend,
        good: "neutral",
      },
      {
        label: "Sales from social ads",
        value: formatMoney(cur.value, currencies[0]),
        now: cur.value,
        before: prev.value,
      },
      {
        label: "Return on ad spend",
        value: times(roas(cur)),
        now: roas(cur),
        before: roas(prev),
      },
    );
  }
  if (r.social)
    tiles.push(
      {
        label: "Social reach",
        value: whole(r.social.current.reach),
        now: r.social.current.reach,
        before: r.social.previous.reach,
      },
      {
        label: "Social engagements",
        value: whole(r.social.current.engagements),
        now: r.social.current.engagements,
        before: r.social.previous.engagements,
      },
    );
  if (r.google?.analytics)
    tiles.push({
      label: "Website visits (28 days)",
      value: whole(r.google.analytics.sessions),
      now: r.google.analytics.sessions,
      before: r.google.analytics.prevSessions,
    });
  if (r.search)
    tiles.push({
      label: "Searches in Google's top 10",
      value: `${r.search.top10} of ${r.search.tracked}`,
      now: r.search.top10,
      before: r.search.prevTop10,
    });
  if (!tiles.length) return null;
  return (
    <Section
      title="At a glance"
      sub={`Changes are against ${r.range.prevLabel}.`}
    >
      <Tiles tiles={tiles.slice(0, 8)} />
    </Section>
  );
}

function PaidSocial({ r }: { r: Report }) {
  return (
    <Section
      title="Paid social ads"
      sub="Facebook, Instagram and TikTok campaigns: what they cost and the sales the networks put down to them."
    >
      {r.paid.length === 0 ? (
        <Empty>
          No ad accounts connected. Connect them in{" "}
          <Link to="/app/paid-social">Paid social ads</Link>.
        </Empty>
      ) : (
        r.paid.map((a) => {
          const max = Math.max(0, ...a.campaigns.map((c) => c.spend));
          return (
            <div key={`${a.network}:${a.name}`} className="rp-block">
              <h3>
                <i
                  className="rp-key"
                  style={{ background: AD_COLOR[a.network] }}
                />{" "}
                {AD_NETWORK_NAME[a.network]} · {a.name}
              </h3>
              {a.error ? (
                <Empty>Couldn&apos;t read this account: {a.error}</Empty>
              ) : (
                <>
                  <Tiles
                    tiles={[
                      {
                        label: "Spend",
                        value: formatMoney(a.current.spend, a.currency),
                        now: a.current.spend,
                        before: a.previous.spend,
                        good: "neutral",
                      },
                      {
                        label: "Clicks",
                        value: whole(a.current.clicks),
                        now: a.current.clicks,
                        before: a.previous.clicks,
                      },
                      {
                        label: "Cost per click",
                        value: a.current.clicks
                          ? formatMoney(
                              a.current.spend / a.current.clicks,
                              a.currency,
                            )
                          : "–",
                        now: a.current.clicks
                          ? a.current.spend / a.current.clicks
                          : null,
                        before: a.previous.clicks
                          ? a.previous.spend / a.previous.clicks
                          : null,
                        good: "down",
                      },
                      {
                        label: "Purchases",
                        value: whole(a.current.purchases),
                        now: a.current.purchases,
                        before: a.previous.purchases,
                      },
                      {
                        label: "Sales",
                        value: formatMoney(a.current.value, a.currency),
                        now: a.current.value,
                        before: a.previous.value,
                      },
                      {
                        label: "Return on ad spend",
                        value: times(roas(a.current)),
                        now: roas(a.current),
                        before: roas(a.previous),
                      },
                    ]}
                  />
                  {a.campaigns.length > 0 && (
                    <table className="rp-table">
                      <thead>
                        <tr>
                          <th>Biggest campaigns</th>
                          <th className="rp-barcol">Spend</th>
                          <th className="rp-num">Clicks</th>
                          <th className="rp-num">Purchases</th>
                          <th className="rp-num">Sales</th>
                          <th className="rp-num">Return</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.campaigns.map((c) => (
                          <tr key={c.name}>
                            <td>{c.name}</td>
                            <td className="rp-barcol">
                              <div className="rp-barcell">
                                <Bar
                                  value={c.spend}
                                  max={max}
                                  color={AD_COLOR[a.network]}
                                  label={`${c.name}: ${formatMoney(c.spend, a.currency)}`}
                                />
                                <span>{formatMoney(c.spend, a.currency)}</span>
                              </div>
                            </td>
                            <td className="rp-num">{whole(c.clicks)}</td>
                            <td className="rp-num">{whole(c.purchases)}</td>
                            <td className="rp-num">
                              {formatMoney(c.value, a.currency)}
                            </td>
                            <td className="rp-num">{times(roas(c))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          );
        })
      )}
    </Section>
  );
}

function Social({ r }: { r: Report }) {
  const s = r.social;
  return (
    <Section
      title="Social posts"
      sub="Posts sent from the social calendar and blog shares. Figures are read from each network every hour."
    >
      {!s ? (
        <Empty>
          No social accounts connected. Connect them in{" "}
          <Link to="/app/social">Social accounts</Link>.
        </Empty>
      ) : (
        <>
          <Tiles
            tiles={[
              {
                label: "Posts",
                value: whole(s.current.posts),
                now: s.current.posts,
                before: s.previous.posts,
              },
              {
                label: "Reach",
                value: whole(s.current.reach),
                now: s.current.reach,
                before: s.previous.reach,
              },
              {
                label: "Engagements",
                value: whole(s.current.engagements),
                now: s.current.engagements,
                before: s.previous.engagements,
              },
              {
                label: "Engagement rate",
                value: pct(s.current.rate),
                now: s.current.rate,
                before: s.previous.rate,
              },
              {
                label: "Clicks",
                value: whole(s.current.clicks),
                now: s.current.clicks,
                before: s.previous.clicks,
              },
            ]}
          />
          {s.byNetwork.length > 0 && (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="rp-num">Posts</th>
                  <th className="rp-num">Reach</th>
                  <th className="rp-barcol">Engagements</th>
                  <th className="rp-num">Rate</th>
                </tr>
              </thead>
              <tbody>
                {s.byNetwork.map((b) => (
                  <tr key={b.network}>
                    <td>
                      <i
                        className="rp-key"
                        style={{ background: NETWORK_COLOR[b.network] }}
                      />{" "}
                      {NETWORK_NAME[b.network]}
                    </td>
                    <td className="rp-num">{whole(b.posts)}</td>
                    <td className="rp-num">{whole(b.reach)}</td>
                    <td className="rp-barcol">
                      <div className="rp-barcell">
                        <Bar
                          value={b.engagements ?? 0}
                          max={Math.max(
                            ...s.byNetwork.map((x) => x.engagements ?? 0),
                          )}
                          color={NETWORK_COLOR[b.network]}
                          label={`${NETWORK_NAME[b.network]}: ${whole(b.engagements)} engagements`}
                        />
                        <span>{whole(b.engagements)}</span>
                      </div>
                    </td>
                    <td className="rp-num">{pct(b.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="rp-pair">
            <div>
              <h3>Top posts</h3>
              {s.top.length === 0 ? (
                <Empty>No figures for this period&apos;s posts yet.</Empty>
              ) : (
                <ol className="rp-posts">
                  {s.top.map((p, i) => (
                    <li key={i}>
                      <span className="rp-post-text">
                        {p.text || "(no caption)"}
                      </span>
                      <span className="rp-post-meta">
                        {NETWORK_NAME[p.network]} · {dayShort(p.day)} ·{" "}
                        {whole(p.engagements)} engagements
                        {p.reach != null ? ` · ${whole(p.reach)} reach` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div>
              <h3>Followers</h3>
              {s.followers.length === 0 ? (
                <Empty>
                  Follower counts start the day after an account is connected.
                </Empty>
              ) : (
                <table className="rp-table">
                  <tbody>
                    {s.followers.map((f) => (
                      <tr key={`${f.network}:${f.name}`}>
                        <td>
                          <i
                            className="rp-key"
                            style={{ background: NETWORK_COLOR[f.network] }}
                          />{" "}
                          {f.name}
                        </td>
                        <td className="rp-num">{whole(f.end)}</td>
                        <td className="rp-num">
                          {f.start != null && f.end != null
                            ? `${f.end >= f.start ? "+" : "−"}${whole(Math.abs(f.end - f.start))}`
                            : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <p className="rp-note rp-screen">
            Post by post, with charts by day and hashtags:{" "}
            <Link to="/app/publishing?section=reports">
              Social calendar reports
            </Link>
            .
          </p>
        </>
      )}
    </Section>
  );
}

function Google({ r }: { r: Report }) {
  const g = r.google;
  const when = g?.checkedAt
    ? new Date(g.checkedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : null;
  return (
    <Section
      title="Website and Google Ads"
      sub={`From your own Google Analytics and Google Ads: the last 28 days for Analytics and 30 for Ads, against the same before${when ? `, as read on ${when}` : ""}.`}
    >
      {!g ? (
        <Empty>
          Google isn&apos;t connected. Connect it in{" "}
          <Link to="/app/google">Google Analytics and Ads</Link>.
        </Empty>
      ) : (
        <>
          {g.analytics && (
            <div className="rp-block">
              <h3>Google Analytics</h3>
              <Tiles
                tiles={[
                  {
                    label: "Visits",
                    value: whole(g.analytics.sessions),
                    now: g.analytics.sessions,
                    before: g.analytics.prevSessions,
                  },
                  {
                    label: "Visitors",
                    value: whole(g.analytics.users),
                    note: " ",
                  },
                  {
                    label: "Purchases",
                    value: whole(g.analytics.purchases),
                    now: g.analytics.purchases,
                    before: g.analytics.prevPurchases,
                  },
                  {
                    label: "Sales",
                    value: formatMoney(
                      g.analytics.revenue,
                      g.analytics.currency,
                    ),
                    now: g.analytics.revenue,
                    before: g.analytics.prevRevenue,
                  },
                ]}
              />
              {g.analytics.channels.length > 0 && (
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>Where visits came from</th>
                      <th className="rp-barcol">Visits</th>
                      <th className="rp-num">Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.analytics.channels.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="rp-barcol">
                          <div className="rp-barcell">
                            <Bar
                              value={c.sessions}
                              max={g.analytics!.channels[0].sessions}
                              label={`${c.name}: ${whole(c.sessions)} visits`}
                            />
                            <span>{whole(c.sessions)}</span>
                          </div>
                        </td>
                        <td className="rp-num">
                          {formatMoney(c.revenue, g.analytics!.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {g.ads && (
            <div className="rp-block">
              <h3>Google Ads</h3>
              <Tiles
                tiles={[
                  {
                    label: "Spend",
                    value: formatMoney(g.ads.spend, g.ads.currency),
                    now: g.ads.spend,
                    before: g.ads.prevSpend,
                    good: "neutral",
                  },
                  { label: "Clicks", value: whole(g.ads.clicks), note: " " },
                  {
                    label: "Conversions",
                    value: whole(g.ads.conversions),
                    note: " ",
                  },
                  {
                    label: "Conversion value",
                    value: formatMoney(g.ads.value, g.ads.currency),
                    now: g.ads.value,
                    before: g.ads.prevValue,
                  },
                  {
                    label: "Return on ad spend",
                    value: times(roas(g.ads)),
                    now: roas(g.ads),
                    before: roas({
                      spend: g.ads.prevSpend,
                      value: g.ads.prevValue,
                    }),
                  },
                ]}
              />
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const place = (p: number | null) => (p == null ? "Not in top 30" : `#${p}`);

function Rankings({ r }: { r: Report }) {
  const s = r.search;
  return (
    <Section
      title="Google rankings"
      sub="Where your website shows in Google for the searches you track, now and at the start of the period."
    >
      {!s ? (
        <Empty>
          No searches tracked yet. Add some in{" "}
          <Link to="/app/ranks">Rank tracker</Link>.
        </Empty>
      ) : (
        <>
          <Tiles
            tiles={[
              { label: "Searches tracked", value: whole(s.tracked), note: " " },
              {
                label: "In the top 3",
                value: whole(s.top3),
                now: s.top3,
                before: s.prevTop3,
              },
              {
                label: "In the top 10",
                value: whole(s.top10),
                now: s.top10,
                before: s.prevTop10,
              },
            ]}
          />
          {s.movers.length > 0 && (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Biggest moves</th>
                  <th className="rp-num">Was</th>
                  <th className="rp-num">Now</th>
                  <th className="rp-num">Change</th>
                </tr>
              </thead>
              <tbody>
                {s.movers.map((m) => {
                  const d = (m.from ?? 31) - (m.to ?? 31);
                  return (
                    <tr key={m.keyword}>
                      <td>{m.keyword}</td>
                      <td className="rp-num">{place(m.from)}</td>
                      <td className="rp-num">{place(m.to)}</td>
                      <td className={`rp-num ${d > 0 ? "rp-good" : "rp-bad"}`}>
                        {d > 0 ? "▲" : "▼"} {Math.abs(d)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
  );
}

function Competitors({ r }: { r: Report }) {
  const c = r.competitors;
  return (
    <Section
      title="Competitors"
      sub="Their estimated Google search visits and search ad spend a month, live ads in the ad libraries, and the changes spotted in the period."
    >
      {!c ? (
        <Empty>
          No competitors added yet. Add them in{" "}
          <Link to="/app/competitors">Competitors</Link>.
        </Empty>
      ) : (
        <>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Competitor</th>
                <th className="rp-num">Search visits</th>
                <th className="rp-num">Change</th>
                <th className="rp-num">Search ad spend</th>
                <th className="rp-num">Live ads</th>
                <th className="rp-num">New ads</th>
                <th className="rp-num">Changes spotted</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td>
                  <td className="rp-num">{compact(x.organicTraffic)}</td>
                  <td className="rp-num">
                    <Delta
                      now={x.organicTraffic}
                      before={x.prevOrganicTraffic}
                      good="neutral"
                    />
                  </td>
                  <td className="rp-num">{dollars(x.paidCostCents)}</td>
                  <td className="rp-num">{whole(x.liveAds)}</td>
                  <td className="rp-num">{whole(x.newAds)}</td>
                  <td className="rp-num">{whole(x.changes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.events.length > 0 && (
            <ul className="rp-chips">
              {c.events.map((e) => (
                <li key={e.kind}>
                  <strong>{e.count}</strong>{" "}
                  {(EVENT_LABEL[e.kind] ?? e.kind).toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

// --- The page ----------------------------------------------------------------

export default function Reports() {
  const d = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const monthly = useFetcher<typeof action>();
  const sendNow = useFetcher<typeof action>();
  const r = d.report;
  const reportOn = monthly.formData
    ? monthly.formData.get("on") === "true"
    : d.reportOn;
  const sent = sendNow.state === "idle" ? sendNow.data : undefined;
  const created = new Date(r.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <s-page heading="Reports">
      <s-button
        slot="primary-action"
        variant="primary"
        icon="print"
        onClick={() => window.print()}
      >
        Print or save as PDF
      </s-button>
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            One report of how your marketing is doing: what your social ads cost
            and brought in, how your posts did, your website&apos;s visits and
            sales, your Google rankings and what your competitors did. Print it
            or save it as a PDF to share with your team or clients.
          </s-paragraph>
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
            gap="base"
            alignItems="end"
          >
            <s-select
              label="Period"
              value={d.period}
              disabled={navigation.state !== "idle"}
              onChange={(e) => navigate(`?period=${e.currentTarget.value}`)}
            >
              {REPORT_PERIODS.map((p) => (
                <s-option key={p.key} value={p.key}>
                  {p.label}
                </s-option>
              ))}
            </s-select>
            <s-checkbox
              label="Email me last month's report on the 1st"
              details={
                d.email
                  ? `Sent to ${d.email}.`
                  : "Add your email address in Settings."
              }
              checked={reportOn}
              onChange={(e) =>
                monthly.submit(
                  { intent: "monthly", on: String(e.currentTarget.checked) },
                  { method: "post" },
                )
              }
            />
            {d.emailOn && (
              <s-button
                loading={sendNow.state !== "idle"}
                onClick={() =>
                  sendNow.submit(
                    { intent: "send", period: d.period },
                    { method: "post" },
                  )
                }
              >
                Email me this report
              </s-button>
            )}
          </s-grid>
          {sent && "error" in sent && (
            <s-banner tone="critical">{sent.error}</s-banner>
          )}
          {sent && "sent" in sent && (
            <s-banner tone="success">Report sent to {sent.sent}.</s-banner>
          )}
        </s-stack>
      </s-section>

      <div className="rp-doc">
        <header className="rp-head">
          <div>
            <p className="rp-brand">SimilarWise · Performance report</p>
            <h1>{r.site ?? r.shop.replace(/\.myshopify\.com$/, "")}</h1>
          </div>
          <div className="rp-period">
            <strong>{r.range.label}</strong>
            <span>Compared with {r.range.prevLabel}</span>
            <span>Made {created}</span>
          </div>
        </header>
        <Summary r={r} />
        <PaidSocial r={r} />
        <Social r={r} />
        <Google r={r} />
        <Rankings r={r} />
        <Competitors r={r} />
        <footer className="rp-foot">
          Paid social and social post figures are as each network reports them.
          Competitor figures are estimates.
        </footer>
      </div>
      <style>{CSS}</style>
    </s-page>
  );
}

const CSS = `
.rp-doc { background: #fff; border: 1px solid #e3e3e3; border-radius: 12px; padding: 28px 32px; margin-top: 16px; color: #1a1a1a; font-size: 13px; line-height: 1.45; }
.rp-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; margin-bottom: 8px; }
.rp-brand { margin: 0 0 4px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #2f5bea; font-weight: 700; }
.rp-head h1 { margin: 0; font-size: 24px; }
.rp-period { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; color: #616161; }
.rp-period strong { color: #1a1a1a; font-size: 15px; }
.rp-section { padding: 18px 0 6px; border-bottom: 1px solid #ebebeb; }
.rp-section:last-of-type { border-bottom: 0; }
.rp-section header h2 { margin: 0; font-size: 17px; }
.rp-section header p { margin: 2px 0 12px; color: #616161; }
.rp-block { margin-bottom: 14px; }
.rp-block h3, .rp-pair h3 { margin: 4px 0 8px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
.rp-tiles { display: grid; gap: 8px; margin-bottom: 12px; }
.rp-tile { background: #f6f6f7; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.rp-tile-label { color: #616161; font-size: 12px; }
.rp-tile strong { font-size: 19px; font-variant-numeric: tabular-nums; }
.rp-delta { font-size: 12px; color: #616161; min-height: 1em; white-space: nowrap; }
.rp-good { color: #0c7a43; }
.rp-bad { color: #b42318; }
.rp-table { width: 100%; border-collapse: collapse; margin: 4px 0 12px; font-variant-numeric: tabular-nums; }
.rp-table th { text-align: left; font-weight: 600; color: #616161; font-size: 12px; border-bottom: 1px solid #e3e3e3; padding: 6px 8px 6px 0; }
.rp-table td { border-bottom: 1px solid #f1f1f1; padding: 6px 8px 6px 0; vertical-align: middle; }
.rp-num { text-align: right !important; white-space: nowrap; }
.rp-barcol { width: 34%; }
td.rp-barcol .rp-barcell { display: flex; align-items: center; gap: 8px; }
.rp-bar { flex: 1; height: 10px; display: block; }
.rp-bar i { display: block; height: 100%; border-radius: 0 4px 4px 0; }
.rp-barcell > span:last-child { min-width: 80px; text-align: right; }
.rp-key { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; }
.rp-pair { display: grid; grid-template-columns: 3fr 2fr; gap: 24px; }
.rp-posts { margin: 0; padding-left: 18px; }
.rp-posts li { margin-bottom: 8px; }
.rp-post-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rp-post-meta { display: block; color: #616161; font-size: 12px; }
.rp-chips { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 0 0 12px; }
.rp-chips li { background: #f6f6f7; border-radius: 999px; padding: 3px 10px; }
.rp-empty { color: #616161; background: #fafafa; border: 1px dashed #e3e3e3; border-radius: 8px; padding: 12px; margin: 0 0 12px; }
.rp-note { color: #616161; margin: 0 0 12px; }
.rp-foot { margin-top: 18px; color: #8a8a8a; font-size: 11px; }
@media (max-width: 700px) { .rp-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } .rp-pair { grid-template-columns: 1fr; } .rp-head { flex-direction: column; align-items: flex-start; } .rp-period { align-items: flex-start; } }
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  .rp-doc, .rp-doc * { visibility: visible; }
  .rp-doc { position: absolute; left: 0; top: 0; width: 100%; border: 0; padding: 0; margin: 0; font-size: 11px; }
  .rp-screen { display: none; }
  .rp-section, .rp-block, .rp-table tr, .rp-tile { break-inside: avoid; }
  .rp-section header { break-after: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  a { color: inherit; text-decoration: none; }
}
`;

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
