import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
// Brings in the JSX types for App Bridge elements such as <s-app-nav>.
import type {} from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { detectShopMarket } from "../lib/traffic/refresh.server";
import { detectShopDomain } from "../lib/traffic/gap.server";
import { detectAlertEmail } from "../lib/email/alerts.server";
import { isOwnerShop } from "../lib/survey.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Read once, and only when a new shop's country, website or email is needed.
  let shopInfo: Promise<{ country: string | null; host: string | null; email: string | null }> | undefined;
  const readShop = () =>
    (shopInfo ??= admin
      .graphql(`{ shop { billingAddress { countryCodeV2 } primaryDomain { host } email } }`)
      .then((res) => res.json())
      .then(({ data }) => ({
        country: data?.shop?.billingAddress?.countryCodeV2 ?? null,
        host: data?.shop?.primaryDomain?.host ?? null,
        email: data?.shop?.email ?? null,
      })));
  await detectShopMarket(session.shop, async () => (await readShop()).country);
  await detectShopDomain(session.shop, async () => (await readShop()).host);
  await detectAlertEmail(session.shop, async () => (await readShop()).email);
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
        <s-link href="/app/prices">Price comparison</s-link>
        <s-link href="/app/keywords">Keyword gap</s-link>
        <s-link href="/app/channels">Marketing channels</s-link>
        <s-link href="/app/ads">Ads</s-link>
        <s-link href="/app/settings">Email alerts</s-link>
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
