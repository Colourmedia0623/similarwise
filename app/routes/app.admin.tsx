import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { timeAgo } from "../lib/format";
import { webAccountFor } from "../lib/web/context.server";
import { adminOverview, isAdminEmail, setWorkspaceFree } from "../lib/web/admin.server";
import { validEmail } from "../lib/web/shop";
import { escapeHtml, mailer } from "../lib/email/send.server";

// The super admin page of the web version: every account, workspace and plan,
// the waitlist, invitations and free access. Only for ADMIN_EMAILS.

async function requireAdmin(request: Request) {
  await authenticate.admin(request);
  const account = await webAccountFor(request);
  if (!account || !isAdminEmail(account.user.email)) throw new Response("Not found", { status: 404 });
  return account;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  return adminOverview();
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "free") {
    await setWorkspaceFree(String(form.get("workspaceId") ?? ""), form.get("free") === "true");
    return { ok: "Saved." };
  }
  if (intent === "invite") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!validEmail(email)) return { error: "Enter an email address." };
    // Being on the waitlist is what lets someone sign up while sign-ups are closed.
    await db.waitlistEntry.upsert({ where: { email }, create: { email }, update: {} });
    const send = mailer();
    if (!send) return { ok: `${email} can sign up now. Emails aren't switched on, so send them the link yourself.` };
    const link = `${process.env.SHOPIFY_APP_URL || new URL(request.url).origin}/signup`;
    await send({
      to: email,
      subject: "You're invited to SimilarWise",
      text: `You're invited to SimilarWise: see what your competitors do, then do it better.\n\nCreate your account with this email address: ${link}`,
      html: `<p>You're invited to SimilarWise: see what your competitors do, then do it better.</p><p><a href="${escapeHtml(link)}">Create your account</a> with this email address.</p>`,
    }).catch((err) => console.error("Couldn't send an invite", err));
    return { ok: `Invited ${email}.` };
  }
  return { error: "Unknown action." };
};

export default function Admin() {
  const { totals, users, workspaces, waitlist } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Admin">
      {result && "ok" in result && <s-banner tone="success">{result.ok}</s-banner>}
      {result && "error" in result && <s-banner tone="critical">{result.error}</s-banner>}

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
          {[
            ["Accounts", totals.users],
            ["Workspaces", totals.workspaces],
            ["Paying", totals.paying],
            ["On trial", totals.trials],
            ["Shopify installs", totals.shopifyStores],
            ["Waitlist", totals.waitlist],
          ].map(([label, n]) => (
            <s-box key={label} padding="base" border="base" borderRadius="base">
              <s-text color="subdued">{label}</s-text>
              <s-heading>{String(n)}</s-heading>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Invite someone">
        <Form method="post">
          <input type="hidden" name="intent" value="invite" />
          <s-stack direction="inline" gap="small" alignItems="end">
            <s-email-field name="email" label="Email" placeholder="name@company.com" />
            <s-button type="submit" variant="primary" disabled={busy}>
              Send invite
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={`Workspaces (${workspaces.length})`}>
        <s-table>
          <s-table-header-row>
            <s-table-header>Workspace</s-table-header>
            <s-table-header>Plan</s-table-header>
            <s-table-header>People</s-table-header>
            <s-table-header>Created</s-table-header>
            <s-table-header>Free access</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {workspaces.map((w) => (
              <s-table-row key={w.id}>
                <s-table-cell>
                  <s-stack gap="none">
                    <s-text type="strong">{w.name}</s-text>
                    <s-text color="subdued">{[w.website, w.platform].filter(Boolean).join(" · ") || "No website"}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={w.paying ? "success" : w.status === "Free" ? "info" : w.status.startsWith("Trial") ? "warning" : "neutral"}>{w.status}</s-badge>
                </s-table-cell>
                <s-table-cell>{w.members.join(", ")}</s-table-cell>
                <s-table-cell>{timeAgo(w.createdAt)}</s-table-cell>
                <s-table-cell>
                  <Form method="post">
                    <input type="hidden" name="intent" value="free" />
                    <input type="hidden" name="workspaceId" value={w.id} />
                    <input type="hidden" name="free" value={String(!w.free)} />
                    <s-button type="submit" variant="tertiary" disabled={busy}>
                      {w.free ? "Remove" : "Make free"}
                    </s-button>
                  </Form>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading={`Accounts (${users.length})`}>
        <s-table>
          <s-table-header-row>
            <s-table-header>Email</s-table-header>
            <s-table-header>Name</s-table-header>
            <s-table-header>Workspaces</s-table-header>
            <s-table-header>Signed up</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {users.map((u) => (
              <s-table-row key={u.email}>
                <s-table-cell>
                  {u.email} {u.admin && <s-badge tone="info">Admin</s-badge>} {u.google && <s-badge>Google</s-badge>}
                </s-table-cell>
                <s-table-cell>{u.name ?? "–"}</s-table-cell>
                <s-table-cell>{u.workspaces.join(", ") || "None yet"}</s-table-cell>
                <s-table-cell>{timeAgo(u.createdAt)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading={`Waitlist (${waitlist.length})`}>
        <s-paragraph>Everyone here can sign up while sign-ups are closed.</s-paragraph>
        <s-table>
          <s-table-header-row>
            <s-table-header>Email</s-table-header>
            <s-table-header>Store</s-table-header>
            <s-table-header>Joined</s-table-header>
            <s-table-header>Account</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {waitlist.map((w) => (
              <s-table-row key={w.email}>
                <s-table-cell>{w.email}</s-table-cell>
                <s-table-cell>{w.store ?? "–"}</s-table-cell>
                <s-table-cell>{timeAgo(w.createdAt)}</s-table-cell>
                <s-table-cell>{w.joined ? <s-badge tone="success">Signed up</s-badge> : <s-text color="subdued">Not yet</s-text>}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
