import type { ActionFunctionArgs } from "react-router";
import { fetchSubscription, syncSubscription, verifyWebhook } from "../lib/web/stripe.server";

// Stripe tells us here when a web workspace's subscription starts, changes,
// fails to renew or ends. Add this URL as a webhook endpoint in Stripe, with
// the customer.subscription.* and checkout.session.completed events.
export const action = async ({ request }: ActionFunctionArgs) => {
  const payload = await request.text();
  if (!verifyWebhook(payload, request.headers.get("stripe-signature"))) return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  try {
    if (event.type.startsWith("customer.subscription.")) await syncSubscription(event.data.object as Parameters<typeof syncSubscription>[0]);
    else if (event.type === "checkout.session.completed" && typeof event.data.object.subscription === "string")
      await syncSubscription(await fetchSubscription(event.data.object.subscription));
  } catch (err) {
    console.error("Stripe webhook failed", event.type, err);
    return new Response("Failed", { status: 500 });
  }
  return new Response("ok");
};

export const loader = () => new Response("Stripe webhooks are sent here by POST.", { status: 405 });
