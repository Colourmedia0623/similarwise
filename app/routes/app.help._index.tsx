import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { HOW_TOS } from "../lib/help";

// Every how-to video, one per section, in menu order.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Help() {
  return (
    <s-page heading="Help videos">
      <s-section>
        <s-paragraph>A short video for each part of SimilarWise, showing what it does and how to use it. Each page also has a Watch how-to button.</s-paragraph>
      </s-section>
      <s-section>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Video</s-table-header>
            <s-table-header>Section</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {HOW_TOS.map((h) => (
              <s-table-row key={h.slug}>
                <s-table-cell>
                  <s-link href={`/app/help/${h.slug}`}>{h.title}</s-link>
                </s-table-cell>
                <s-table-cell>
                  <s-link href={h.path}>{h.section}</s-link>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
