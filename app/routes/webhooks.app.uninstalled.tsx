import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { disconnectGoogle } from "../lib/google/google.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // Google access is given up straight away, not only when Shopify asks for the shop's data to go.
  await disconnectGoogle(shop).catch((err) => console.error("Couldn't disconnect Google", shop, err));

  return new Response();
};
