import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { safeNext } from "../lib/web/auth.server";
import { googleLoginOn, googleLoginStart } from "../lib/web/google-login.server";

// Sends the browser to Google to log in or sign up.
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (!googleLoginOn()) throw redirect("/login?error=" + encodeURIComponent("Google sign-in isn't set up yet. Use your email and password."));
  const { url: to, cookie } = googleLoginStart(url.searchParams.get("intent") === "signup" ? "signup" : "login", safeNext(url.searchParams.get("next")));
  throw redirect(to, { headers: { "set-cookie": cookie } });
};
