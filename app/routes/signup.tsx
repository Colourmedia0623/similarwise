import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { AuthPage, GoogleButton, authStyles as s } from "../components/web/AuthPage";
import { hashPassword, passwordProblem, safeNext, signupAllowed, startSession, webAccount } from "../lib/web/auth.server";
import { googleLoginOn } from "../lib/web/google-login.server";
import { validEmail } from "../lib/web/shop";
import { TRIAL_DAYS } from "../lib/billing";

// Creating an account on the standalone web version. The workspace (their
// store or agency) is set up next, on /welcome.

export const meta: MetaFunction = () => [{ title: "Create your account · SimilarWise" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  if (await webAccount(request)) throw redirect(next);
  return { next, google: googleLoginOn(), open: process.env.WEB_SIGNUP === "open" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!validEmail(email)) return { error: "Enter your email address." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (!(await signupAllowed(email))) return { error: "waitlist" as const };
  if (await db.webUser.findUnique({ where: { email } })) return { error: "There's already an account with that email. Log in instead." };
  const user = await db.webUser.create({ data: { email, name: name || null, passwordHash: await hashPassword(password) } });
  throw redirect(`/welcome?next=${encodeURIComponent(next)}`, { headers: { "set-cookie": await startSession(user.id, null) } });
};

export default function Signup() {
  const { next, google, open } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <AuthPage
      title="Create your account"
      lead={
        <>
          {open ? `Every plan starts with a ${TRIAL_DAYS}-day free trial. ` : ""}Already have an account? <a href={`/login?next=${encodeURIComponent(next)}`}>Log in</a>
        </>
      }
      footer={<p className={s.shopify}>On Shopify? Install SimilarWise from the Shopify App Store instead, and it opens inside your Shopify admin.</p>}
    >
      {result?.error === "waitlist" ? (
        <div className={s.error}>
          SimilarWise is opening to new accounts a few at a time. <a href="/#waitlist">Join the waitlist</a> with this email and we’ll let you know when yours is ready.
        </div>
      ) : (
        result?.error && <div className={s.error}>{result.error}</div>
      )}
      {google && (
        <>
          <div style={{ marginTop: result?.error ? 14 : 0 }}>
            <GoogleButton href={`/login/google?intent=signup&next=${encodeURIComponent(next)}`} label="Sign up with Google" />
          </div>
          <div className={s.or}>or</div>
        </>
      )}
      <Form method="post" className={s.form}>
        <input type="hidden" name="next" value={next} />
        <label className={s.field}>
          Your name
          <input name="name" autoComplete="name" />
        </label>
        <label className={s.field}>
          Work email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className={s.field}>
          Password
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          <span className={s.hint}>At least 8 characters.</span>
        </label>
        <button className={s.primary} type="submit" disabled={busy}>
          {busy ? "Creating your account…" : "Create account"}
        </button>
      </Form>
      <div className={s.links}>
        <span>
          By signing up you agree to the <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.
        </span>
      </div>
    </AuthPage>
  );
}
