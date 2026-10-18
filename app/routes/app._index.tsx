import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { overview } from "../lib/dashboard.server";
import { EVENT_LABEL, EVENT_TONE, compact, formatPrice, timeAgo } from "../lib/format";

// Overview: a tile for each page with its headline number, what the shop's
// competitors changed this week, and the latest activity.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return overview(session.shop);
};

type Tiles = ReturnType<typeof useLoaderData<typeof loader>>["tiles"];

const ICONS: Record<string, string> = {
  store: "M3 9l1.5-5h15L21 9M4 9v11h16V9M3 9h18M9 20v-6h6v6",
  radar: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M12 12l6-6",
  tag: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-5-5",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  pen: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 8a5 5 0 0 1 0 8",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  mail: "M3 5h18v14H3zM3 7l9 6 9-6",
};

type Tile = { href: string; icon: string; title: string; text: string; stat: string | null };

// "224 sites", or nothing when there's no number yet.
const stat = (v: number | null, label: string, format = (x: number) => x.toLocaleString("en")) => (v == null ? null : `${format(v)} ${label}`);

function groups(t: Tiles): { title: string; color: string; tiles: Tile[] }[] {
  return [
    {
      title: "Your competitors",
      color: "#2563eb",
      tiles: [
        { href: "/app/competitors", icon: "store", title: "Competitors", text: "Track their products, prices and launches every day.", stat: `${t.competitors} of ${t.maxCompetitors} tracked` },
        { href: "/app/similar", icon: "radar", title: "Similar sites", text: "Find stores competing for the same Google searches.", stat: stat(t.similar, "found") },
        { href: "/app/prices", icon: "tag", title: "Price comparison", text: "Your prices side by side with theirs.", stat: stat(t.matched, "products matched") },
        { href: "/app/tech", icon: "layers", title: "Website technologies", text: "The theme and apps each store runs.", stat: stat(t.apps, "apps spotted") },
      ],
    },
    {
      title: "Search and SEO",
      color: "#7c3aed",
      tiles: [
        { href: "/app/keywords", icon: "search", title: "Keyword gap", text: "Searches they rank for on Google and you don't.", stat: stat(t.missingKeywords, "keywords to win") },
        { href: "/app/ideas", icon: "bulb", title: "Keyword ideas", text: "Page titles and descriptions written for those searches.", stat: stat(t.keywordIdeas, "ideas") },
        { href: "/app/articles", icon: "pen", title: "Blog articles", text: "Articles written for those searches, sent to your blog.", stat: stat(t.articles, "on your blog") },
        { href: "/app/calendar", icon: "calendar", title: "Content calendar", text: "A blog post a day, written and published for you.", stat: stat(t.plannedPosts, "posts planned") },
        { href: "/app/links", icon: "link", title: "Link gap", text: "Sites linking to them that could link to you.", stat: stat(t.linkSites, "sites") },
        { href: "/app/outreach", icon: "mail", title: "Outreach emails", text: "Emails asking those sites to link to you.", stat: stat(t.outreachSent, "sent") },
      ],
    },
    {
      title: "Marketing and alerts",
      color: "#ea580c",
      tiles: [
        { href: "/app/traffic", icon: "trend", title: "Traffic and engagement", text: "Visits over time, time on site and bounce rate.", stat: stat(t.measured, "sites measured") },
        { href: "/app/channels", icon: "chart", title: "Marketing channels", text: "Where their visitors come from, beside your own.", stat: stat(t.searchVisits, "search visits a month", compact) },
        { href: "/app/ads", icon: "megaphone", title: "Ads", text: "The ads they're running on Meta, TikTok and Google.", stat: stat(t.liveAds, "live ads") },
        { href: "/app/ad-ideas", icon: "sparkle", title: "Ad ideas", text: "What works in their ads, turned into ideas for yours.", stat: stat(t.adIdeas, "ideas") },
        { href: "/app/settings", icon: "mail", title: "Email alerts", text: "An email when a competitor changes something, and a Monday summary.", stat: t.alertsOn ? "Alerts on" : "Alerts off" },
      ],
    },
  ];
}

const CSS = `
.sw-hero { border-radius: 16px; padding: 28px 28px 24px; color: #fff; background: linear-gradient(120deg, #1e3a8a 0%, #4f46e5 55%, #7c3aed 100%); }
.sw-hero h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.2; font-weight: 700; }
.sw-hero p { margin: 0; font-size: 15px; opacity: .9; max-width: 560px; }
.sw-hero a { display: inline-block; margin-top: 16px; padding: 9px 16px; border-radius: 10px; background: #fff; color: #1e3a8a; font-weight: 600; text-decoration: none; }
.sw-group h2 { margin: 0 0 10px; font-size: 13px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: #616161; }
.sw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.sw-tile { display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: 14px; background: #fff; border: 1px solid #e3e3e3; text-decoration: none; color: #303030; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
.sw-tile:hover, .sw-tile:focus-visible { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.08); border-color: var(--sw-accent); outline: none; }
.sw-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: var(--sw-accent); background: color-mix(in srgb, var(--sw-accent) 12%, #fff); }
.sw-tile strong { font-size: 15px; font-weight: 650; }
.sw-tile span { font-size: 13px; color: #616161; line-height: 1.4; }
.sw-stat { margin-top: auto; padding-top: 4px; font-size: 13px; font-weight: 600; color: var(--sw-accent); }
`;

function TileGrid({ tiles }: { tiles: Tiles }) {
  return (
    <s-stack gap="large">
      {groups(tiles).map((g) => (
        <div key={g.title} className="sw-group" style={{ ["--sw-accent" as string]: g.color }}>
          <h2>{g.title}</h2>
          <div className="sw-grid">
            {g.tiles.map((t) => (
              <Link key={t.href} to={t.href} className="sw-tile">
                <div className="sw-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={ICONS[t.icon]} />
                  </svg>
                </div>
                <strong>{t.title}</strong>
                <span>{t.text}</span>
                {t.stat && <div className="sw-stat">{t.stat}</div>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </s-stack>
  );
}

export default function Index() {
  const { competitors, week, recent, searchOn, tiles } = useLoaderData<typeof loader>();
  const none = competitors.length === 0;

  return (
    <s-page heading="Similarwise">
      <style>{CSS}</style>
      <s-stack gap="large">
        <div className="sw-hero">
          <h1>{none ? "See what your competitors are doing" : "Your competitors at a glance"}</h1>
          <p>
            {none
              ? "Add the stores you compete with. Similarwise checks them every day and shows you their prices, searches, ads and apps."
              : `Tracking ${competitors.length} competitor${competitors.length === 1 ? "" : "s"}. This week they launched ${week.launches} product${week.launches === 1 ? "" : "s"} and changed ${week.priceChanges} price${week.priceChanges === 1 ? "" : "s"}.`}
          </p>
          {none && <Link to="/app/competitors">Add your first competitor</Link>}
        </div>

        {!none && (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            <Stat label="New products this week" value={week.launches} />
            <Stat label="Price changes" value={week.priceChanges} />
            <Stat label="Products taken down" value={week.removed} />
            <Stat label="Ad changes" value={week.channelChanges} />
          </s-grid>
        )}

        <TileGrid tiles={tiles} />
      </s-stack>

      {!none && (
        <s-section heading="Latest activity">
          {recent.length === 0 ? (
            <s-paragraph>Nothing has changed yet. Similarwise checks each competitor once a day.</s-paragraph>
          ) : (
            <s-stack gap="small">
              {recent.map((e) => (
                <s-stack key={e.id} direction="inline" gap="small" alignItems="center">
                  <s-badge tone={EVENT_TONE[e.kind] ?? "neutral"}>{EVENT_LABEL[e.kind] ?? e.kind}</s-badge>
                  <s-link href={`/app/competitors/${e.competitor.id}`}>{e.competitor.name}</s-link>
                  <s-text>{e.message}</s-text>
                  <s-text color="subdued">{timeAgo(e.createdAt)}</s-text>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-section>
      )}

      {!none && (
        <s-section heading="Your competitors">
          <s-table>
            <s-table-header-row>
              <s-table-header>Competitor</s-table-header>
              <s-table-header>Ad and analytics channels</s-table-header>
              {searchOn && <s-table-header format="numeric">Search visits a month</s-table-header>}
              {searchOn && <s-table-header format="numeric">Google Ads spend a month</s-table-header>}
              <s-table-header format="numeric">Products</s-table-header>
              <s-table-header format="numeric">Average price</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {competitors.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`/app/competitors/${c.id}`}>{c.name}</s-link>
                    {c.lastError ? <s-text tone="critical"> Check failed</s-text> : null}
                  </s-table-cell>
                  <s-table-cell>{c.adChannels.length ? c.adChannels.join(", ") : "None seen"}</s-table-cell>
                  {searchOn && <s-table-cell>{compact(c.organicTraffic)}</s-table-cell>}
                  {searchOn && <s-table-cell>{c.paidCostCents != null ? formatPrice(c.paidCostCents, "USD") : "–"}</s-table-cell>}
                  <s-table-cell>{c.productCount.toLocaleString()}</s-table-cell>
                  <s-table-cell>{c.avgPriceCents != null ? formatPrice(c.avgPriceCents, c.currency) : "–"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value.toLocaleString()}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
