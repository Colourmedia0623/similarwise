import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import db from "../db.server";
import { AuthPage, authStyles as s } from "../components/web/AuthPage";
import { createResetToken } from "../lib/web/auth.server";
import { escapeHtml, mailer } from "../lib/email/send.server";

// Emails a link for choosing a new password.

export const meta: MetaFunction = () => [{ title: "Reset your password · SimilarWise" }];

export const action = async ({ request }: ActionFunctionArgs) => {
  const email = String((await request.formData()).get("email") ?? "").trim().toLowerCase();
  const user = email ? await db.webUser.findUnique({ where: { email } }) : null;
  const send = mailer();
  if (user && send) {
    const link = `${process.env.SHOPIFY_APP_URL || new URL(request.url).origin}/reset-password?token=${await createResetToken(user.id)}`;
    await send({
      to: user.email,
      subject: "Reset your SimilarWise password",
      text: `Choose a new SimilarWise password here: ${link}\n\nThe link works for an hour. If you didn't ask for this, you can ignore this email.`,
      html: `<p>Choose a new SimilarWise password:</p><p><a href="${escapeHtml(link)}">Reset my password</a></p><p>The link works for an hour. If you didn't ask for this, you can ignore this email.</p>`,
    }).catch((err) => console.error("Couldn't send a password reset", err));
  }
  // The same answer either way, so this can't be used to find out who has an account.
  return { sent: true };
};

export default function ForgotPassword() {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <AuthPage title="Reset your password" lead="We'll email you a link to choose a new one.">
      {result?.sent ? (
        <div className={s.notice}>If there’s an account with that email, a reset link is on its way. Check your inbox.</div>
      ) : (
        <Form method="post" className={s.form}>
          <label className={s.field}>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <button className={s.primary} type="submit" disabled={busy}>
            Send reset link
          </button>
        </Form>
      )}
      <div className={s.links}>
        <a href="/login">Back to log in</a>
      </div>
    </AuthPage>
  );
}
