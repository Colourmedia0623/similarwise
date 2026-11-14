import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { endSession } from "../lib/web/auth.server";

// Logs the browser out of the web version. A form post, so links can't log anyone out.
export const loader = () => redirect("/login");

export const action = async ({ request }: ActionFunctionArgs) =>
  redirect("/login", { headers: { "set-cookie": await endSession(request) } });
