import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { webAccount } from "../lib/web/auth.server";
import { portalUrl, stripeOn } from "../lib/web/stripe.server";

// Opens Stripe's billing page for the workspace: card, invoices, cancelling.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const account = await webAccount(request);
  if (!account?.workspace) throw redirect("/login?next=/app/plans");
  const url = stripeOn() ? await portalUrl(account.workspace.id) : null;
  throw redirect(url ?? "/app/plans");
};
