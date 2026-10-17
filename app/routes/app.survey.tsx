import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { timeAgo } from "../lib/format";
import { isOwnerShop, surveyResults, type Tally } from "../lib/survey.server";

// The early-access survey results against the pitch test's targets. Only
// Colourmedia's own stores can open it.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isOwnerShop(session.shop)) throw new Response("Not found", { status: 404 });
  return surveyResults();
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

function TallyTable({ heading, rows }: { heading: string; rows: Tally }) {
  return (
    <s-section heading={heading}>
      <s-table>
        <s-table-header-row>
          <s-table-header>Answer</s-table-header>
          <s-table-header format="numeric">Merchants</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {rows.map((r) => (
            <s-table-row key={r.label}>
              <s-table-cell>{r.label}</s-table-cell>
              <s-table-cell>{r.count}</s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

export default function Survey() {
  const r = useLoaderData<typeof loader>();
  const top = r.features.filter((f) => f.count > 0).slice(0, 3);
  return (
    <s-page heading="Survey results">
      <s-section heading="Against the pitch targets">
        <s-stack gap="small-200">
          <s-paragraph>
            Answers: <s-text type="strong">{r.total}</s-text> of 20 · Sign-ups: <s-text type="strong">{r.total}</s-text>{" "}
            of 100
          </s-paragraph>
          <s-paragraph>
            Would pay $49 a month or more: <s-text type="strong">{pct(r.willPay49Share)}</s-text> ({r.willPay49}), target
            30%
          </s-paragraph>
          <s-paragraph>
            Top features: {top.length ? top.map((f) => `${f.label} (${f.count})`).join(", ") : "none yet"}
          </s-paragraph>
          <s-paragraph>
            Share the survey: <s-link href="https://similarwise.colourmedia.net/#early-access" target="_blank">similarwise.colourmedia.net</s-link>
          </s-paragraph>
        </s-stack>
      </s-section>

      <TallyTable heading="Features wanted" rows={r.features} />
      <TallyTable heading="What they'd pay" rows={r.price} />
      <TallyTable heading="Store revenue" rows={r.revenue} />
      <TallyTable heading="How they track competitors today" rows={r.tracking} />

      <s-section heading="Everyone on the waitlist">
        {r.entries.length === 0 ? (
          <s-paragraph>No answers yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Email</s-table-header>
              <s-table-header>Store</s-table-header>
              <s-table-header>Revenue</s-table-header>
              <s-table-header>Would pay</s-table-header>
              <s-table-header>Wants</s-table-header>
              <s-table-header>Their question</s-table-header>
              <s-table-header>Joined</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {r.entries.map((e) => (
                <s-table-row key={e.email}>
                  <s-table-cell>{e.email}</s-table-cell>
                  <s-table-cell>{e.store ?? "–"}</s-table-cell>
                  <s-table-cell>{e.revenue}</s-table-cell>
                  <s-table-cell>{e.price}</s-table-cell>
                  <s-table-cell>{e.features.join(", ")}</s-table-cell>
                  <s-table-cell>{e.question ?? "–"}</s-table-cell>
                  <s-table-cell>{timeAgo(e.createdAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
