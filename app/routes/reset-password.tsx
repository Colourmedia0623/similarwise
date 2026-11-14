import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { AuthPage, authStyles as s } from "../components/web/AuthPage";
import { hashPassword, passwordProblem, consumeResetToken } from "../lib/web/auth.server";

// Choosing a new password from an emailed link. Logs out every other browser.

export const meta: MetaFunction = () => [{ title: "Choose a new password · SimilarWise" }];

export const loader = ({ request }: LoaderFunctionArgs) => ({ token: new URL(request.url).searchParams.get("token") ?? "" });

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const userId = await consumeResetToken(String(form.get("token") ?? ""));
  if (!userId) return { error: "This link has expired or was already used. Ask for a new one." };
  await db.webUser.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  await db.webSession.deleteMany({ where: { userId } });
  throw redirect("/login?reset");
};

export default function ResetPassword() {
  const { token } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <AuthPage title="Choose a new password">
      <Form method="post" className={s.form}>
        {result?.error && <div className={s.error}>{result.error}</div>}
        <input type="hidden" name="token" value={token} />
        <label className={s.field}>
          New password
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          <span className={s.hint}>At least 8 characters.</span>
        </label>
        <button className={s.primary} type="submit" disabled={busy}>
          Save new password
        </button>
      </Form>
      <div className={s.links}>
        <a href="/forgot-password">Send a new link</a>
      </div>
    </AuthPage>
  );
}
