import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { switchWorkspace, webAccount } from "../lib/web/auth.server";

// Switches the web version to another of the person's workspaces.
export const loader = () => redirect("/app");

export const action = async ({ request }: ActionFunctionArgs) => {
  const account = await webAccount(request);
  if (!account) throw redirect("/login");
  await switchWorkspace(account, String((await request.formData()).get("workspaceId") ?? ""));
  return redirect("/app");
};
