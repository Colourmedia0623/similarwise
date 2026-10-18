import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { auditOverview, startAudit } from "../lib/audit/audit.server";

// Site audit: the SEO problems on the shop's own storefront, worst first,
// with how to fix each one.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return auditOverview(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return startAudit(session.shop);
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const TONE = { error: "critical", warning: "warning", notice: "info" } as const;
const LABEL = { error: "Error", warning: "Warning", notice: "Notice" } as const;
const path = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

export default function Audit() {
  const d = useLoaderData<typeof loader>();
  const check = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const checking = d.running || check.state !== "idle";
  const checkError = check.state === "idle" && check.data && "error" in check.data ? check.data.error : null;
  const change = d.score != null && d.before != null ? d.score - d.before : null;

  // Reading the store takes a minute or two, so keep looking while it runs.
  useEffect(() => {
    if (!d.running) return;
    const t = setInterval(() => revalidator.revalidate(), 10_000);
    return () => clearInterval(t);
  }, [d.running, revalidator]);

  return (
    <s-page heading="Site audit">
      {d.domain && (
        <s-button slot="primary-action" variant="primary" loading={checking} onClick={() => check.submit({}, { method: "post" })}>
          Check now
        </s-button>
      )}
      {!d.domain && (
        <s-banner tone="warning">
          Add your store&apos;s website on the <s-link href="/app/keywords">Keyword gap</s-link> page so it can be checked.
        </s-banner>
      )}

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Each week SimilarWise reads your home page and a sample of your products, collections, pages and blog posts the way Google does, and lists
            anything that could hold back your search rankings.
          </s-paragraph>
          {checking && <s-banner tone="info">Reading your store. This takes a minute or two; the page updates by itself.</s-banner>}
          {checkError && <s-banner tone="warning">{checkError}</s-banner>}
          {d.error && !checking && <s-banner tone="warning">{d.error}</s-banner>}
          {d.checkedAt && !checking && (
            <s-text color="subdued">
              Last checked {day(d.checkedAt)}, {d.pages} pages. Checked again every week.
            </s-text>
          )}
        </s-stack>
      </s-section>

      {d.score != null && (
        <s-section heading="Site health">
          <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-200">
                <s-text color="subdued">Score</s-text>
                <s-heading>{`${d.score} / 100`}</s-heading>
                {change != null && change !== 0 && <s-text tone={change > 0 ? "success" : "critical"}>{`${change > 0 ? "↑" : "↓"} ${Math.abs(change)} since last week`}</s-text>}
              </s-stack>
            </s-box>
            {(["error", "warning", "notice"] as const).map((sev) => (
              <s-box key={sev} padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">{`${LABEL[sev]}s`}</s-text>
                  <s-heading>{String(d.counts[sev])}</s-heading>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        </s-section>
      )}

      {d.score != null && d.issues.length === 0 && (
        <s-section>
          <s-banner tone="success">No problems found on the pages checked.</s-banner>
        </s-section>
      )}

      {d.issues.map((i) => (
        <s-section key={i.code}>
          <s-stack gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={TONE[i.severity]}>{LABEL[i.severity]}</s-badge>
              <s-heading>{`${i.label} (${i.pages.length})`}</s-heading>
            </s-stack>
            <s-paragraph>{i.fix}</s-paragraph>
            <details>
              <summary style={{ cursor: "pointer" }}>Show pages</summary>
              <s-stack gap="small-200">
                {i.pages.map((p, n) => (
                  <s-text key={`${p.url}-${n}`}>
                    <s-link href={p.url} target="_blank">
                      {path(p.url)}
                    </s-link>
                    {p.detail ? ` · ${p.detail}` : ""}
                  </s-text>
                ))}
              </s-stack>
            </details>
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
