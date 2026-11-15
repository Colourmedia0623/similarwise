import type { ActionFunctionArgs } from "react-router";
import { webAccount } from "../lib/web/auth.server";
import { markSeen } from "../lib/web/notifications.server";

// Opening the bell in the web version marks everything in it as seen.
export const action = async ({ request }: ActionFunctionArgs) => {
  const account = await webAccount(request);
  if (!account?.workspace) return new Response("Not signed in", { status: 401 });
  await markSeen(account.user.id, account.workspace.id);
  return { ok: true };
};
