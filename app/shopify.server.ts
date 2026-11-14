import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, BillingInterval, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PLANS, TRIAL_DAYS, planKey } from "./lib/billing";
import { webAdminContext } from "./lib/web/context.server";

// Two charges per plan: every 30 days, or once a year at the yearly monthly price times twelve.
const billing = Object.fromEntries(
  PLANS.flatMap((p) => [
    [planKey(p.tier, "monthly"), { trialDays: TRIAL_DAYS, lineItems: [{ amount: p.monthly, currencyCode: "USD", interval: BillingInterval.Every30Days as const }] }],
    [planKey(p.tier, "yearly"), { trialDays: TRIAL_DAYS, lineItems: [{ amount: p.yearly * 12, currencyCode: "USD", interval: BillingInterval.Annual as const }] }],
  ]),
);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
// Every app page calls authenticate.admin. A website login (the standalone
// web version, lib/web) answers first, looking like a Shopify login whose
// shop is the workspace's key; requests from Shopify admin never carry it,
// so they always go to Shopify's own login as before.
export const authenticate = {
  ...shopify.authenticate,
  admin: async (request: Request) =>
    ((await webAdminContext(request)) as unknown as Awaited<ReturnType<typeof shopify.authenticate.admin>> | null) ??
    shopify.authenticate.admin(request),
} as typeof shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
