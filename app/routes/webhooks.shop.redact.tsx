import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactShop } from "../lib/privacy.server";

// Mandatory privacy webhook for public apps, sent 48 hours after a shop
// uninstalls: deletes everything the app holds for it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const r = await redactShop(shop);
  console.log(`Received ${topic} webhook for ${shop}: removed ${JSON.stringify(r)}`);
  return new Response();
};
