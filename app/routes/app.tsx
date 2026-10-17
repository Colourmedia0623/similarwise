import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
// Brings in the JSX types for App Bridge elements such as <s-app-nav>.
import type {} from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { detectShopMarket } from "../lib/traffic/refresh.server";
import { isOwnerShop } from "../lib/survey.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await detectShopMarket(session.shop, async () => {
    const res = await admin.graphql(`{ shop { billingAddress { countryCodeV2 } } }`);
    const { data } = await res.json();
    return data?.shop?.billingAddress?.countryCodeV2 ?? null;
  });
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", owner: isOwnerShop(session.shop) };
};

export default function App() {
  const { apiKey, owner } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Overview</s-link>
        <s-link href="/app/competitors">Competitors</s-link>
        {owner && <s-link href="/app/survey">Survey results</s-link>}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
