import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Copyable } from "../components/Copyable";
import { linkGap, linksClient, refreshLinks, writePitch } from "../lib/links/links.server";
import { claudeJson } from "../lib/ideas/claude.server";

// The link gap: websites that link to competitors but not to the shop, with
// an outreach email for each on request.

const SHOWN = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: linksClient() != null, pitchOn: claudeJson() != null, ...(await linkGap(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "pitch") {
    const site = String(form.get("site") ?? "");
    try {
      return { site, ...(await writePitch(session.shop, site)) };
    } catch (err) {
      console.error("Couldn't write a pitch", session.shop, err);
      return { site, error: "Couldn't write that email just now. Try again in a minute." };
    }
  }
  const competitors = await db.competitor.findMany({ where: { shop: session.shop }, select: { id: true } });
  for (const c of competitors) await refreshLinks(c.id, { force: true });
  return { ok: true as const };
};

export default function Links() {
  const { on, pitchOn, domain, competitors, sites, shared } = useLoaderData<typeof loader>();
  const refresh = useFetcher<typeof action>();
  const errors = [...new Set(competitors.flatMap((c) => (c.error ? [c.error] : [])))];
  const waiting = competitors.some((c) => !c.ready && !c.error);
  return (
    <s-page heading="Link gap">
      {on && domain && competitors.length > 0 && (
        <s-button slot="primary-action" loading={refresh.state !== "idle"} onClick={() => refresh.submit({ intent: "refresh" }, { method: "post" })}>
          Refresh
        </s-button>
      )}
      {!on && <s-banner tone="info">Link data isn&apos;t switched on for this app yet.</s-banner>}
      {errors.map((e) => (
        <s-banner key={e} tone="warning">
          {e}
        </s-banner>
      ))}

      <s-section>
        <s-paragraph>
          Websites that link to your competitors but not to you. Ones linking to several competitors come first, since they&apos;re the most
          likely to link to you too. Only followed links from sites that don&apos;t look like spam are counted.
        </s-paragraph>
        {!domain && (
          <s-paragraph>
            Add your website on the <s-link href="/app/keywords">Keyword gap</s-link> page first.
          </s-paragraph>
        )}
        {domain && competitors.length === 0 && (
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        )}
        {domain && competitors.length > 0 && sites.length === 0 && on && (
          <s-paragraph>{waiting ? "No sites yet. Press Refresh to fetch them." : "No sites found yet."}</s-paragraph>
        )}
        {sites.length > 0 && (
          <s-text color="subdued">
            {sites.length} sites link to your competitors and not you; {shared} link to more than one.
          </s-text>
        )}
      </s-section>

      {sites.length > 0 && (
        <s-section>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Website</s-table-header>
              <s-table-header>Links to</s-table-header>
              <s-table-header format="numeric">Authority</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {sites.slice(0, SHOWN).map((s) => (
                <s-table-row key={s.domain}>
                  <s-table-cell>
                    <s-link href={`https://${s.domain}`} target="_blank">
                      {s.domain}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{s.competitors.map((c) => c.name).join(", ")}</s-table-cell>
                  <s-table-cell>{s.rank ?? "–"}</s-table-cell>
                  <s-table-cell>
                    {s.platform ? (
                      <s-link href={`https://${s.domain}`} target="_blank">
                        Post here
                      </s-link>
                    ) : (
                      pitchOn && <PitchButton site={s.domain} />
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {sites.length > SHOWN && <s-text color="subdued">Showing the top {SHOWN} of {sites.length}.</s-text>}
        </s-section>
      )}
      <s-section>
        <s-text color="subdued">Authority is DataForSEO&apos;s rank for the site, from 0 to 100. Refreshed weekly.</s-text>
      </s-section>
    </s-page>
  );
}

function PitchButton({ site }: { site: string }) {
  const pitch = useFetcher<typeof action>();
  const data = pitch.data && "site" in pitch.data && pitch.data.site === site ? pitch.data : null;
  return (
    <s-stack gap="small">
      <s-button variant="tertiary" loading={pitch.state !== "idle"} onClick={() => pitch.submit({ intent: "pitch", site }, { method: "post" })}>
        {data && "subject" in data ? "Write another email" : "Write email"}
      </s-button>
      {data && "error" in data && data.error && <s-text tone="critical">{data.error}</s-text>}
      {data && "subject" in data && (
        <s-stack gap="small">
          <Copyable label="Subject" text={data.subject} />
          <Copyable label="Email" text={data.body} />
        </s-stack>
      )}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
