import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { timeAgo } from "../lib/format";
import { adsOverview, refreshAds, setMetaPage, setTiktokAdvertiser } from "../lib/ads/ads.server";
import { PLATFORM_LABEL } from "../lib/ads/platforms";
import { adsClient, type Platform } from "../lib/ads/scrapecreators.server";

// The ads competitors are running on Meta, TikTok and Google, from the
// platforms' public ad libraries, and which accounts are theirs.

const PLATFORMS: Platform[] = ["meta", "tiktok", "google"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const platform = PLATFORMS.find((p) => p === url.searchParams.get("platform"));
  const competitorId = url.searchParams.get("competitor") || undefined;
  return { on: adsClient() != null, ...(await adsOverview(session.shop, { platform, competitorId })) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("competitorId") ?? "");
  const intent = form.get("intent");
  if (intent === "meta") await setMetaPage(session.shop, id, String(form.get("pageId") ?? "") || null);
  else if (intent === "tiktok") await setTiktokAdvertiser(session.shop, id, String(form.get("name") ?? ""));
  else {
    const competitors = await db.competitor.findMany({ where: { shop: session.shop }, select: { id: true } });
    for (const c of competitors) await refreshAds(c.id, { force: true });
  }
  return { ok: true };
};

export default function Ads() {
  const { on, competitors, ads } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const refresh = useFetcher();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <s-page heading="Ads">
      {on && competitors.length > 0 && (
        <s-button slot="primary-action" loading={refresh.state !== "idle"} onClick={() => refresh.submit({ intent: "refresh" }, { method: "post" })}>
          Refresh
        </s-button>
      )}
      {!on && <s-banner tone="info">Ad data isn&apos;t switched on for this app yet.</s-banner>}
      {competitors
        .filter((c) => c.error)
        .map((c) => (
          <s-banner key={c.id} tone="warning">
            {c.name}: couldn&apos;t read some ads ({c.error})
          </s-banner>
        ))}

      {competitors.length === 0 ? (
        <s-section>
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section heading="Running now">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Competitor</s-table-header>
                <s-table-header format="numeric">Meta</s-table-header>
                <s-table-header format="numeric">TikTok</s-table-header>
                <s-table-header format="numeric">Google</s-table-header>
                <s-table-header>Checked</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {competitors.map((c) => (
                  <s-table-row key={c.id}>
                    <s-table-cell>{c.name}</s-table-cell>
                    <s-table-cell>{c.meta.id ? c.counts.meta : "–"}</s-table-cell>
                    <s-table-cell>{c.tiktok.name ? c.counts.tiktok : "–"}</s-table-cell>
                    <s-table-cell>{c.counts.google}</s-table-cell>
                    <s-table-cell>{c.checked ? timeAgo(c.checked) : "Not yet"}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-section heading="Their ads">
            <s-stack gap="base">
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
                <s-select label="Competitor" value={params.get("competitor") ?? ""} onChange={(e) => set("competitor", e.currentTarget.value)}>
                  <s-option value="">All competitors</s-option>
                  {competitors.map((c) => (
                    <s-option key={c.id} value={c.id}>
                      {c.name}
                    </s-option>
                  ))}
                </s-select>
                <s-select label="Platform" value={params.get("platform") ?? ""} onChange={(e) => set("platform", e.currentTarget.value)}>
                  <s-option value="">All platforms</s-option>
                  {PLATFORMS.map((p) => (
                    <s-option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>
              {ads.length === 0 ? (
                <s-paragraph>No running ads found yet.</s-paragraph>
              ) : (
                <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
                  {ads.map((a) => (
                    <AdCard key={a.id} ad={a} />
                  ))}
                </s-grid>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Their accounts">
            <s-stack gap="base">
              <s-paragraph>
                <s-text color="subdued">
                  Similarwise finds each competitor&apos;s Facebook page and TikTok advertiser by name. Correct them here if
                  they&apos;re wrong. Google ads are found by their website.
                </s-text>
              </s-paragraph>
              {competitors.map((c) => (
                <Accounts key={c.id} competitor={c} />
              ))}
            </s-stack>
          </s-section>
        </>
      )}
    </s-page>
  );
}

type Loaded = Awaited<ReturnType<typeof loader>>;

function AdCard({ ad }: { ad: Loaded["ads"][number] }) {
  const words = ad.title ?? ad.text;
  return (
    <s-box border="base" borderRadius="base" padding="small" background="base">
      <s-stack gap="small">
        {ad.imageUrl && (
          <s-link href={ad.adUrl ?? ad.imageUrl} target="_blank">
            <s-image src={ad.imageUrl} alt={words ?? `${ad.competitor} ad`} aspectRatio="1" objectFit="cover" borderRadius="base" />
          </s-link>
        )}
        <s-stack direction="inline" gap="small-200">
          <s-badge>{PLATFORM_LABEL[ad.platform]}</s-badge>
          {ad.format && <s-badge tone="neutral">{ad.format.toLowerCase()}</s-badge>}
        </s-stack>
        <s-text type="strong">{ad.competitor}</s-text>
        {words && <s-text>{words.length > 140 ? `${words.slice(0, 137)}…` : words}</s-text>}
        <s-text color="subdued">
          {ad.startedAt ? `Running since ${new Date(ad.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "Running"}
          {ad.cta ? ` · ${ad.cta}` : ""}
        </s-text>
        {ad.adUrl && (
          <s-link href={ad.adUrl} target="_blank">
            View in ad library
          </s-link>
        )}
      </s-stack>
    </s-box>
  );
}

function Accounts({ competitor: c }: { competitor: Loaded["competitors"][number] }) {
  const meta = useFetcher();
  const tiktok = useFetcher();
  const [name, setName] = useState(c.tiktok.name ?? "");
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="base">
        <s-heading>{c.name}</s-heading>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          <s-select
            label="Facebook and Instagram page"
            value={c.meta.id ?? ""}
            disabled={meta.state !== "idle"}
            onChange={(e) => meta.submit({ intent: "meta", competitorId: c.id, pageId: e.currentTarget.value }, { method: "post" })}
          >
            <s-option value="">{c.meta.candidates.length ? "None of these" : "Not found"}</s-option>
            {c.meta.candidates.map((p) => (
              <s-option key={p.id} value={p.id}>
                {p.name}
                {p.likes ? ` (${p.likes.toLocaleString("en")} likes)` : ""}
              </s-option>
            ))}
          </s-select>
          <s-stack direction="inline" gap="small" alignItems="end">
            <s-text-field
              label="TikTok advertiser name"
              value={name}
              placeholder={c.tiktok.candidates[0] ?? "As shown in TikTok's ad library"}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <s-button
              loading={tiktok.state !== "idle"}
              disabled={name.trim() === (c.tiktok.name ?? "")}
              onClick={() => tiktok.submit({ intent: "tiktok", competitorId: c.id, name }, { method: "post" })}
            >
              Save
            </s-button>
          </s-stack>
        </s-grid>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
