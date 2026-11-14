import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { AuthPage, GoogleButton, authStyles as s } from "../components/web/AuthPage";
import { loginFailed, loginLocked, loginSucceeded, safeNext, startSession, verifyPassword, webAccount } from "../lib/web/auth.server";
import { googleLoginOn } from "../lib/web/google-login.server";

// Logging in to the standalone web version. Shopify stores open the app from
// their Shopify admin instead.

export const meta: MetaFunction = () => [{ title: "Log in · SimilarWise" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  if (await webAccount(request)) throw redirect(next);
  return { next, google: googleLoginOn(), error: url.searchParams.get("error"), reset: url.searchParams.has("reset") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (loginLocked(email)) return { error: "Too many tries. Wait 15 minutes, or reset your password." };
  const user = email ? await db.webUser.findUnique({ where: { email } }) : null;
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    loginFailed(email);
    return { error: user && !user.passwordHash ? "This account uses Google. Press Continue with Google." : "That email and password don't match." };
  }
  loginSucceeded(email);
  const last = await db.webSession.findFirst({ where: { userId: user.id, workspaceId: { not: null } }, orderBy: { createdAt: "desc" } });
  throw redirect(next, { headers: { "set-cookie": await startSession(user.id, last?.workspaceId ?? null) } });
};

export default function Login() {
  const { next, google, error, reset } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const problem = result?.error ?? error;
  return (
    <AuthPage
      title="Log in"
      lead={
        <>
          New to SimilarWise? <a href={`/signup${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</a>
        </>
      }
      footer={<p className={s.shopify}>Using SimilarWise on Shopify? Open it from the Apps menu in your Shopify admin.</p>}
    >
      {google && (
        <>
          <GoogleButton href={`/login/google?next=${encodeURIComponent(next)}`} label="Continue with Google" />
          <div className={s.or}>or</div>
        </>
      )}
      <Form method="post" className={s.form}>
        {reset && <div className={s.notice}>Your password has been changed. Log in with the new one.</div>}
        {problem && <div className={s.error}>{problem}</div>}
        <input type="hidden" name="next" value={next} />
        <label className={s.field}>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className={s.field}>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className={s.primary} type="submit" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </Form>
      <div className={s.links}>
        <a href="/forgot-password">Forgot your password?</a>
      </div>
    </AuthPage>
  );
}
