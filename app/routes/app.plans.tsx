import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLANS, PLAN_KEYS, TRIAL_DAYS, parsePlanKey, planKey, type Cycle, type Tier } from "../lib/billing";
import { isOwnerShop } from "../lib/waitlist.server";

// Choosing, changing or cancelling a plan. Charges go through Shopify.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const owner = isOwnerShop(session.shop);
  const { appSubscriptions } = owner ? { appSubscriptions: [] } : await billing.check({ plans: PLAN_KEYS, isTest: true });
  const sub = appSubscriptions[0];
  const need = new URL(request.url).searchParams.get("need");
  return {
    owner,
    current: sub ? { ...parsePlanKey(sub.name), id: sub.id, trialDays: sub.trialDays } : null,
    need: PLANS.find((p) => p.tier === need)?.name ?? null,
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
  const { owner, current, need } = useLoaderData<typeof loader>();
  const [cycle, setCycle] = useState<Cycle>(current?.cycle ?? "yearly");
  const busy = useNavigation().state !== "idle";

  return (
    <s-page heading="Plans">
      {owner && <s-banner tone="info">This is a Colourmedia store, so every feature is already on and nothing is charged.</s-banner>}
      {need && !owner && (
        <s-banner tone="warning">{current ? `That page is part of the ${need} plan. Upgrade to open it.` : `Choose a plan to start your ${TRIAL_DAYS}-day free trial.`}</s-banner>
      )}

      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Every plan starts with a {TRIAL_DAYS}-day free trial. Shopify adds the charge to your store bill, and you can change or cancel at any time.
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
        const on = current?.tier === p.tier && current.cycle === cycle;
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
                  <s-list-item key={i}>{i}</s-list-item>
                ))}
              </s-unordered-list>
              {!owner && (
                <Form method="post">
                  <input type="hidden" name="tier" value={p.tier} />
                  <input type="hidden" name="cycle" value={cycle} />
                  <s-button type="submit" variant="primary" disabled={on || busy}>
                    {on ? "Your plan" : current ? `Switch to ${p.name}` : "Start free trial"}
                  </s-button>
                </Form>
              )}
            </s-stack>
          </s-section>
        );
      })}

      {current?.id && (
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
