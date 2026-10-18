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
import { isOwnerShop } from "../lib/waitlist.server";
import { PLAN_KEYS, covers, pageTier, parsePlanKey, type Tier } from "../lib/billing";

const RANK: Tier[] = ["watch", "grow", "advertise"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing, redirect } = await authenticate.admin(request);
  const owner = isOwnerShop(session.shop);
  // Colourmedia's own stores use everything for free. Everyone else needs a plan that covers the page.
  if (!owner) {
    const { appSubscriptions } = await billing.check({ plans: PLAN_KEYS, isTest: true });
    const tiers = appSubscriptions.map((s) => parsePlanKey(s.name)?.tier).filter((t): t is Tier => t != null);
    const tier = RANK.filter((t) => tiers.includes(t)).pop();
    const path = new URL(request.url).pathname;
    const need = pageTier(path);
    if (path !== "/app/plans" && (!tier || !covers(tier, need))) throw redirect(`/app/plans?need=${need}`);
  }
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
  return { apiKey: process.env.SHOPIFY_API_KEY || "", owner };
};

export default function App() {
  const { apiKey, owner } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Overview</s-link>
        <s-link href="/app/competitors">Competitors</s-link>
        <s-link href="/app/similar">Similar sites</s-link>
        <s-link href="/app/prices">Price comparison</s-link>
        <s-link href="/app/keywords">Keyword gap</s-link>
        <s-link href="/app/audit">Site audit</s-link>
        <s-link href="/app/ai">AI mentions</s-link>
        <s-link href="/app/ideas">Keyword ideas</s-link>
        <s-link href="/app/articles">Blog articles</s-link>
        <s-link href="/app/calendar">Content calendar</s-link>
        <s-link href="/app/links">Link gap</s-link>
        <s-link href="/app/outreach">Outreach emails</s-link>
        <s-link href="/app/social">Social accounts</s-link>
        <s-link href="/app/tech">Website technologies</s-link>
        <s-link href="/app/traffic">Traffic and engagement</s-link>
        <s-link href="/app/channels">Marketing channels</s-link>
        <s-link href="/app/ads">Ads</s-link>
        <s-link href="/app/ad-ideas">Ad ideas</s-link>
        <s-link href="/app/settings">Email alerts</s-link>
        <s-link href="/app/plans">Plans</s-link>
        {owner && <s-link href="/app/waitlist">Waitlist</s-link>}
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
