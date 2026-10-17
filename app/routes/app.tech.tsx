import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { refreshOwnTech, techOverview } from "../lib/tracker/tech.server";

// Website technologies: the theme, apps and ad pixels each competitor's
// store runs, beside the shop's own, grouped by what the apps do.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await refreshOwnTech(session.shop).catch((err) => console.error("Couldn't read own storefront", err));
  return techOverview(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await refreshOwnTech(session.shop, { force: true });
  return { ok: true };
};

const yes = "✓";

export default function Tech() {
  const { domain, own, stores, groups, missing } = useLoaderData<typeof loader>();
  const refresh = useFetcher<typeof action>();
  const name = new Map(stores.map((s) => [s.id, s.name]));
  return (
    <s-page heading="Website technologies">
      {domain && (
        <s-button slot="primary-action" loading={refresh.state !== "idle"} onClick={() => refresh.submit({}, { method: "post" })}>
          Re-read my store
        </s-button>
      )}
      {own?.error && <s-banner tone="warning">{own.error}</s-banner>}

      <s-section>
        <s-paragraph>
          The theme, apps and ad pixels each store loads on its home page. Competitors are re-read every day, so a new app shows up here (and in
          your alerts) soon after they add it.
        </s-paragraph>
        {!domain && (
          <s-paragraph>
            Add your website on the <s-link href="/app/keywords">Keyword gap</s-link> page to see your own store beside theirs.
          </s-paragraph>
        )}
        {stores.length === 0 && (
          <s-paragraph>
            Add a competitor first, on the <s-link href="/app/competitors">Competitors</s-link> page.
          </s-paragraph>
        )}
      </s-section>

      {missing.length > 0 && (
        <s-section heading="Most of your competitors use these and you don't">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">App</s-table-header>
              <s-table-header>What it does</s-table-header>
              <s-table-header>Used by</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {missing.map((m) => (
                <s-table-row key={`${m.category}:${m.name}`}>
                  <s-table-cell>{m.name}</s-table-cell>
                  <s-table-cell>{m.category}</s-table-cell>
                  <s-table-cell>{m.users.map((u) => name.get(u)).join(", ")}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {stores.length > 0 && (
        <s-section heading="Themes">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Store</s-table-header>
              <s-table-header>Theme</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {own?.read && (
                <s-table-row>
                  <s-table-cell>You ({domain})</s-table-cell>
                  <s-table-cell>{own.theme ?? "–"}</s-table-cell>
                </s-table-row>
              )}
              {stores.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>{s.name}</s-table-cell>
                  <s-table-cell>{!s.checked ? "Not checked yet" : s.isShopify ? (s.theme ?? "–") : "Not a Shopify store"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {groups.map((g) => (
        <s-section key={g.category} heading={g.category}>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">App</s-table-header>
              {own?.read && <s-table-header>You</s-table-header>}
              {stores.map((s) => (
                <s-table-header key={s.id}>{s.name}</s-table-header>
              ))}
            </s-table-header-row>
            <s-table-body>
              {g.rows.map((r) => (
                <s-table-row key={r.name}>
                  <s-table-cell>{r.name}</s-table-cell>
                  {own?.read && <s-table-cell>{r.you ? yes : ""}</s-table-cell>}
                  {stores.map((s) => (
                    <s-table-cell key={s.id}>{r.users.includes(s.id) ? yes : ""}</s-table-cell>
                  ))}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ))}

      {stores.length > 0 && (
        <s-section>
          <s-text color="subdued">
            Only well-known apps that load on the home page can be seen, so a store may use more than are shown here.
          </s-text>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
