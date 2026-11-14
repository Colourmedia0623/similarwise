import { redirect } from "react-router";
import db from "../../db.server";
import { PLANS, planKey } from "../billing";
import { webAccount, type WebAccount } from "./auth.server";
import { isWebShop } from "./shop";

// Makes a website login look, to the app's pages, like a Shopify admin login,
// so the same pages serve both. authenticate.admin (shopify.server.ts) asks
// here first and falls back to Shopify's own login.

export const NO_STORE = "No Shopify store is connected to this workspace.";

// Stands in for Shopify's Admin API when there's no store: every query
// answers with no data and an error, the way Shopify answers a query it
// can't run, so pages that read store details show nothing instead of failing.
export const noStoreGraphql = async () =>
  new Response(JSON.stringify({ data: null, errors: [{ message: NO_STORE }] }), { headers: { "content-type": "application/json" } });

const cache = new WeakMap<Request, Promise<WebAccount | null>>();

// The website login for this request, looked up once per request.
export function webAccountFor(request: Request) {
  let p = cache.get(request);
  if (!p) cache.set(request, (p = webAccount(request)));
  return p;
}

type Sub = { id: string; name: string; status: string; test: boolean; trialDays: number; currentPeriodEnd: string; lineItems: never[] };

// What plan a workspace is on, in the shape Shopify's billing.check answers.
export async function workspaceSubscriptions(workspaceId: string, now = new Date()): Promise<Sub[]> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) return [];
  const days = (d: Date | null) => (d ? Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000)) : 0);
  if (ws.plan && ws.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(ws.planStatus ?? ""))
    return [{ id: ws.stripeSubscriptionId, name: ws.plan, status: "ACTIVE", test: false, trialDays: ws.planStatus === "trialing" ? days(ws.periodEndsAt) : 0, currentPeriodEnd: ws.periodEndsAt?.toISOString() ?? "", lineItems: [] }];
  // The free trial every new workspace starts with opens every page.
  if (ws.trialEndsAt && ws.trialEndsAt > now)
    return [{ id: "trial", name: planKey(PLANS[PLANS.length - 1].tier, "monthly"), status: "ACTIVE", test: false, trialDays: days(ws.trialEndsAt), currentPeriodEnd: ws.trialEndsAt.toISOString(), lineItems: [] }];
  return [];
}

// The authenticate.admin answer for a website request, or null when the
// request is Shopify's. Website visitors who aren't signed in go to /login.
export async function webAdminContext(request: Request) {
  const account = await webAccountFor(request);
  if (!account) {
    const { isShopifyRequest } = await import("./auth.server");
    if (isShopifyRequest(request)) return null;
    const url = new URL(request.url);
    // Only plain page visits; anything else is left to Shopify to answer.
    if (request.method !== "GET" || !(request.headers.get("accept") ?? "").includes("text/html")) return null;
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (!account.workspace) throw redirect("/welcome");
  const ws = account.workspace;
  const subs = () => workspaceSubscriptions(ws.id);
  return {
    web: account,
    session: { id: `web_${ws.id}`, shop: ws.shop, state: "", isOnline: false, scope: "", accessToken: "" },
    admin: { graphql: noStoreGraphql },
    redirect: (url: string, init?: number | ResponseInit) => redirect(url, init),
    cors: (r: Response) => r,
    billing: {
      check: async () => {
        const appSubscriptions = await subs();
        return { hasActivePayment: appSubscriptions.length > 0, appSubscriptions, oneTimePurchases: [] };
      },
      require: async ({ onFailure }: { onFailure: (e: unknown) => Promise<Response> }) => {
        const appSubscriptions = await subs();
        if (!appSubscriptions.length) throw await onFailure(new Error("No plan"));
        return { hasActivePayment: true, appSubscriptions, oneTimePurchases: [] };
      },
      // Stripe checkout arrives in the next stage; until then the trial stands in.
      request: async () => {
        throw redirect("/app/plans?billing=soon");
      },
      cancel: async () => ({}),
    },
  };
}

// What routes/app.tsx needs for the web version's frame, or null for Shopify.
export async function webShellAccount(request: Request, shop: string) {
  if (!isWebShop(shop)) return null;
  const account = await webAccountFor(request);
  const ws = account?.workspace;
  if (!account || !ws) return null;
  const trial = (await workspaceSubscriptions(ws.id)).find((s) => s.id === "trial");
  return {
    shell: {
      user: { email: account.user.email, name: account.user.name },
      workspace: { id: ws.id, name: ws.name, website: ws.website },
      workspaces: account.workspaces,
      trialDays: trial ? trial.trialDays : null,
    },
    shopInfo: { country: ws.country, host: ws.website, email: account.user.email },
  };
}
