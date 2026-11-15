import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { webAccount } from "../lib/web/auth.server";
import { THEMES } from "../lib/web/themes";

// Saves the dashboard colour someone picked in the web version's sidebar.
export const action = async ({ request }: ActionFunctionArgs) => {
  const account = await webAccount(request);
  if (!account) return new Response("Not signed in", { status: 401 });
  const theme = String((await request.formData()).get("theme") ?? "");
  if (!THEMES.some((t) => t.key === theme)) return new Response("Unknown colour", { status: 400 });
  await db.webUser.update({ where: { id: account.user.id }, data: { theme } });
  return { ok: true };
};
