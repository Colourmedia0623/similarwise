import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { compact } from "../lib/format";
import { addCompetitor } from "../lib/tracker/check.server";
import { refreshSimilar, similarClient, similarSites } from "../lib/traffic/similar.server";

// Similar sites: websites competing for the same Google searches as the shop
// and its competitors, each one a click from being tracked.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: similarClient() != null, ...(await similarSites(session.shop)) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "add") {
    const domain = String(form.get("domain") ?? "");
    const result = await addCompetitor(session.shop, domain);
    return { domain, ...("error" in result ? { error: result.error } : { added: true }) };
  }
  await refreshSimilar(session.shop, { force: true });
  return { ok: true };
};

export default function Similar() {
  const { on, domain, tracking, full, at, error, sites } = useLoaderData<typeof loader>();
  const refresh = useFetcher<typeof action>();
  return (
    <s-page heading="Similar sites">
      {on && (domain || tracking > 0) && (
        <s-button slot="primary-action" loading={refresh.state !== "idle"} onClick={() => refresh.submit({ intent: "refresh" }, { method: "post" })}>
          Refresh
        </s-button>
      )}
      {!on && <s-banner tone="info">Search data isn&apos;t switched on for this app yet.</s-banner>}
      {error && <s-banner tone="warning">{error}</s-banner>}

      <s-section>
        <s-paragraph>
          Websites that rank on Google for many of the same searches as you and your competitors, so they&apos;re competing for the same
          shoppers. Ones similar to several of the sites you track come first.
        </s-paragraph>
        {!domain && tracking === 0 && (
          <s-paragraph>
            Add your website on the <s-link href="/app/keywords">Keyword gap</s-link> page, or a competitor on the{" "}
            <s-link href="/app/competitors">Competitors</s-link> page, to find sites like them.
          </s-paragraph>
        )}
        {on && (domain || tracking > 0) && sites.length === 0 && (
          <s-paragraph>{at ? "No similar sites found yet." : "No similar sites yet. Press Refresh to look for them."}</s-paragraph>
        )}
        {full && sites.length > 0 && (
          <s-text color="subdued">You&apos;re tracking the most competitors you can. Remove one on the Competitors page to add another.</s-text>
        )}
      </s-section>

      {sites.length > 0 && (
        <s-section>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Website</s-table-header>
              <s-table-header>Similar to</s-table-header>
              <s-table-header format="numeric">Shared searches</s-table-header>
              <s-table-header format="numeric">Search visits a month</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {sites.map((s) => (
                <s-table-row key={s.domain}>
                  <s-table-cell>
                    <s-link href={`https://${s.domain}`} target="_blank">
                      {s.domain}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{s.similarTo.join(", ")}</s-table-cell>
                  <s-table-cell>{compact(s.sharedKeywords)}</s-table-cell>
                  <s-table-cell>{compact(s.traffic)}</s-table-cell>
                  <s-table-cell>{!full && <AddButton domain={s.domain} />}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
      <s-section>
        <s-text color="subdued">Estimates from Google search data. Marketplaces and social sites are left out. Refreshed weekly.</s-text>
      </s-section>
    </s-page>
  );
}

function AddButton({ domain }: { domain: string }) {
  const add = useFetcher<typeof action>();
  const data = add.data && "domain" in add.data && add.data.domain === domain ? add.data : null;
  return (
    <s-stack gap="small-200">
      <s-button variant="tertiary" loading={add.state !== "idle"} onClick={() => add.submit({ intent: "add", domain }, { method: "post" })}>
        Add as competitor
      </s-button>
      {data && "error" in data && <s-text tone="critical">{data.error}</s-text>}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
