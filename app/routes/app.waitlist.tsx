import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { timeAgo } from "../lib/format";
import { isOwnerShop, waitlist } from "../lib/waitlist.server";

// Everyone who joined the early-access waitlist. Only Colourmedia's own
// stores can open it.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isOwnerShop(session.shop)) throw new Response("Not found", { status: 404 });
  return { entries: await waitlist() };
};

export default function Waitlist() {
  const { entries } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Waitlist">
      <s-section heading={`${entries.length} on the waitlist`}>
        {entries.length === 0 ? (
          <s-paragraph>
            No one yet. Share the sign-up: <s-link href="https://similarwise.colourmedia.net/#early-access" target="_blank">similarwise.colourmedia.net</s-link>
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Email</s-table-header>
              <s-table-header>Store</s-table-header>
              <s-table-header>Joined</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {entries.map((e) => (
                <s-table-row key={e.email}>
                  <s-table-cell>{e.email}</s-table-cell>
                  <s-table-cell>{e.store ?? "–"}</s-table-cell>
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
