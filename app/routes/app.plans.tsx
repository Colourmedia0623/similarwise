import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLANS, PLAN_KEYS, TRIAL_DAYS, parsePlanKey, planKey, type Cycle, type Tier } from "../lib/billing";
import { isFreeShop, isOwnerShop } from "../lib/waitlist.server";
import { providerApproved } from "../lib/social/networks.server";
import { HowTo } from "../components/HowTo";
import { isWebShop } from "../lib/web/shop";

// Choosing, changing or cancelling a plan. Charges go through Shopify.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, redirect } = await authenticate.admin(request);
  const owner = isOwnerShop(session.shop);
  const free = isFreeShop(session.shop);
  const url = new URL(request.url);
  // Web workspaces pay by card through Stripe instead of on a Shopify bill.
  const web = isWebShop(session.shop);
  if (web && url.searchParams.get("billing") === "done" && url.searchParams.get("session_id")) {
    const { finishCheckout } = await import("../lib/web/stripe.server");
    await finishCheckout(session.id.replace(/^web_/, ""), url.searchParams.get("session_id")!).catch((err) => console.error("Couldn't read the Stripe checkout", err));
    return redirect("/app/plans?billing=thanks");
  }
  const { appSubscriptions } = free ? { appSubscriptions: [] } : await billing.check({ plans: PLAN_KEYS, isTest: true });
  const sub = appSubscriptions[0];
  const need = url.searchParams.get("need");
  return {
    web,
    billingNote: url.searchParams.get("billing"),
    owner,
    free,
    current: sub ? { ...parsePlanKey(sub.name), id: sub.id, trialDays: sub.trialDays } : null,
    need: PLANS.find((p) => p.tier === need)?.name ?? null,
    // Until Meta and TikTok approve the app, other stores can't connect social accounts yet.
    socialSoon: !free && !(providerApproved("meta") && providerApproved("tiktok")),
  };
};

// Development stores, including Shopify's review stores, can only take test charges.
async function testStore(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]) {
  const res = await admin.graphql(`{ shop { plan { partnerDevelopment } } }`);
  const { data } = await res.json();
  return data?.shop?.plan?.partnerDevelopment !== false;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const isTest = await testStore(admin);
  if (form.get("intent") === "cancel") {
    const id = String(form.get("id") ?? "");
    const { appSubscriptions } = await billing.check({ plans: PLAN_KEYS, isTest: true });
    if (appSubscriptions.some((s) => s.id === id)) await billing.cancel({ subscriptionId: id, isTest, prorate: true });
    return redirect("/app/plans");
  }
  const tier = String(form.get("tier")) as Tier;
  const cycle: Cycle = form.get("cycle") === "yearly" ? "yearly" : "monthly";
  if (!PLANS.some((p) => p.tier === tier)) return { error: "Choose a plan." };
  // Sends the merchant to Shopify to approve the charge, then back into the app.
  return billing.request({ plan: planKey(tier, cycle), isTest });
};

export default function Plans() {
  const { owner, free, current, need, socialSoon, web, billingNote } = useLoaderData<typeof loader>();
  const trial = web && current?.id === "trial";
  const [cycle, setCycle] = useState<Cycle>((!trial && current?.cycle) || "yearly");
  const busy = useNavigation().state !== "idle";

  return (
    <s-page heading="Plans">
      <HowTo video="plans" />
      {free && (
        <s-banner tone="info">
          {owner ? "This is a Colourmedia store, so every feature is already on and nothing is charged." : "This store has free access to SimilarWise, so every feature is already on and nothing is charged."}
        </s-banner>
      )}
      {billingNote === "thanks" && <s-banner tone="success">Thanks, your plan is set up. Every page it includes is open now.</s-banner>}
      {billingNote === "changed" && <s-banner tone="success">Your plan has been changed.</s-banner>}
      {billingNote === "soon" && <s-banner tone="info">Card payments are being switched on. Your free trial carries on until then.</s-banner>}
      {trial && <s-banner tone="info">{`You're on the free trial, with every page open for ${current.trialDays} more day${current.trialDays === 1 ? "" : "s"}. Choose a plan to keep going afterwards; what's left of the trial carries over.`}</s-banner>}
      {need && !free && (
        <s-banner tone="warning">{current ? `That page is part of the ${need} plan. Upgrade to open it.` : `Choose a plan to start your ${TRIAL_DAYS}-day free trial.`}</s-banner>
      )}

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            {web
              ? "Pay by card through Stripe. You can change plan or cancel at any time, and download invoices from the billing page."
              : `Every plan starts with a ${TRIAL_DAYS}-day free trial. Shopify adds the charge to your store bill, and you can change or cancel at any time.`}
          </s-paragraph>
          <s-stack direction="inline" gap="small">
            <s-button variant={cycle === "yearly" ? "primary" : "secondary"} onClick={() => setCycle("yearly")}>
              Pay yearly
            </s-button>
            <s-button variant={cycle === "monthly" ? "primary" : "secondary"} onClick={() => setCycle("monthly")}>
              Pay monthly
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {PLANS.map((p) => {
        const on = !trial && current?.tier === p.tier && current.cycle === cycle;
        const price = cycle === "yearly" ? p.yearly : p.monthly;
        return (
          <s-section key={p.tier} heading={p.tier === "grow" ? `${p.name} (most popular)` : p.name}>
            <s-stack gap="base">
              <s-paragraph>{p.blurb}</s-paragraph>
              <s-heading>${price} a month</s-heading>
              <s-text color="subdued">
                {cycle === "yearly" ? `Billed $${price * 12} once a year, or $${p.monthly} paying monthly.` : `Or $${p.yearly} a month paying yearly.`}
              </s-text>
              <s-unordered-list>
                {p.includes.map((i) => (
                  <s-list-item key={i}>{socialSoon && i.startsWith("Sharing to") ? `${i} (coming soon)` : i}</s-list-item>
                ))}
              </s-unordered-list>
              {!free && (
                <Form method="post">
                  <input type="hidden" name="tier" value={p.tier} />
                  <input type="hidden" name="cycle" value={cycle} />
                  <s-button type="submit" variant="primary" disabled={on || busy}>
                    {on ? "Your plan" : current && !trial ? `Switch to ${p.name}` : web ? `Choose ${p.name}` : "Start free trial"}
                  </s-button>
                </Form>
              )}
            </s-stack>
          </s-section>
        );
      })}

      {web && current && !trial && (
        <s-section heading="Billing">
          <s-stack gap="base">
            <s-paragraph>Change your card, download invoices or cancel on Stripe&apos;s secure billing page.</s-paragraph>
            <s-button href="/billing/portal" target="_top">
              Manage billing
            </s-button>
          </s-stack>
        </s-section>
      )}

      {!web && current?.id && (
        <s-section heading="Cancel">
          <Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <input type="hidden" name="id" value={current.id} />
            <s-button type="submit" tone="critical" disabled={busy}>
              Cancel my plan
            </s-button>
          </Form>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
