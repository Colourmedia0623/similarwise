import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory privacy webhook for public apps. Similarwise stores nothing about
// a shop's customers, so there is nothing to delete.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}: no customer data held`);
  return new Response();
};
