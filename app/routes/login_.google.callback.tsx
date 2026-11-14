import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { signupAllowed, startSession } from "../lib/web/auth.server";
import { clearGoogleCookie, googleLoginFinish, userForGoogle } from "../lib/web/google-login.server";

// Where Google sends the browser back: logs in, or creates the account.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await googleLoginFinish(request);
  const headers = new Headers({ "set-cookie": clearGoogleCookie() });
  if ("error" in result) {
    headers.set("location", `/login?error=${encodeURIComponent(result.error)}`);
    throw new Response(null, { status: 302, headers });
  }
  const { profile, next } = result;
  let user = await userForGoogle(profile);
  if (!user) {
    if (!(await signupAllowed(profile.email))) {
      headers.set("location", `/login?error=${encodeURIComponent(`There's no SimilarWise account for ${profile.email} yet, and new accounts are opening a few at a time. Join the waitlist on the home page.`)}`);
      throw new Response(null, { status: 302, headers });
    }
    user = await db.webUser.create({ data: { email: profile.email, name: profile.name, googleId: profile.sub } });
  }
  const last = await db.webSession.findFirst({ where: { userId: user.id, workspaceId: { not: null } }, orderBy: { createdAt: "desc" } });
  headers.append("set-cookie", await startSession(user.id, last?.workspaceId ?? null));
  headers.set("location", next);
  throw new Response(null, { status: 302, headers });
};

