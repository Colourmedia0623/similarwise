import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { timeAgo } from "../lib/format";
import { webAccountFor } from "../lib/web/context.server";
import { adminOverview, createClientAccount, isAdminEmail, setWorkspaceFree } from "../lib/web/admin.server";
import { cleanWebsite, validEmail } from "../lib/web/shop";
import { createResetToken, openForSupport } from "../lib/web/auth.server";
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
  const account = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  // Opens a customer's workspace to help them; the menu and a banner show it.
  if (intent === "support") {
    if (!(await openForSupport(account, String(form.get("workspaceId") ?? "")))) return { error: "That workspace is gone." };
    throw redirect("/app");
  }
  // Back to the admin's own workspace.
  if (intent === "leave") {
    const own = await db.workspaceMember.findFirst({ where: { userId: account.user.id }, orderBy: { createdAt: "asc" } });
    await openForSupport(account, own?.workspaceId ?? null);
    throw redirect("/app/admin");
  }
  if (intent === "client") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const name = String(form.get("name") ?? "").trim() || null;
    const workspace = String(form.get("workspace") ?? "").trim();
    const rawSite = String(form.get("website") ?? "");
    const website = cleanWebsite(rawSite);
    if (!validEmail(email)) return { error: "Enter the client's email address." };
    if (!workspace) return { error: "Enter a name for their workspace, such as their business name." };
    if (rawSite.trim() && !website) return { error: "That website doesn't look right. Enter it like theirstore.com." };
    const made = await createClientAccount({ email, name, workspace, website, free: form.has("free") });
    const origin = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    // Someone with a password already just logs in; a new login gets a week to choose one.
    const link = made.hasPassword ? `${origin}/login` : `${origin}/reset-password?token=${await createResetToken(made.userId, 7 * 86_400_000)}`;
    const send = form.has("send") ? mailer() : null;
    if (send)
      await send({
        to: email,
        subject: "Your SimilarWise account is ready",
        text: `We've set up SimilarWise for ${workspace}: see what your competitors do, then do it better.\n\n${made.hasPassword ? "Log in" : "Choose your password"}: ${link}${made.hasPassword ? "" : "\n\nThis link works for 7 days. You can also sign in with Google using this email address."}`,
        html: `<p>We've set up SimilarWise for ${escapeHtml(workspace)}: see what your competitors do, then do it better.</p><p><a href="${escapeHtml(link)}">${made.hasPassword ? "Log in" : "Choose your password"}</a></p>${made.hasPassword ? "" : "<p>This link works for 7 days. You can also sign in with Google using this email address.</p>"}`,
      }).catch((err) => console.error("Couldn't send a new account email", err));
    return {
      ok: `${made.existing ? `Added the workspace ${workspace} to ${email}'s account.` : `Made an account for ${email} with the workspace ${workspace}.`} ${send ? "We've emailed them a link to log in." : "Send them this link to log in:"}`,
      link: send ? null : link,
      workspaceId: made.workspaceId,
    };
  }
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
      {result && "ok" in result && (
        <s-banner tone="success">
          <s-stack gap="small">
            <s-text>{result.ok}</s-text>
            {"link" in result && result.link && <code style={{ wordBreak: "break-all", userSelect: "all" }}>{result.link}</code>}
            {"workspaceId" in result && result.workspaceId && <SupportButton workspaceId={result.workspaceId} label="Open their account" busy={busy} />}
          </s-stack>
        </s-banner>
      )}
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

      <s-section heading="Preview new sign-ups">
        <s-stack gap="base">
          <s-paragraph>See each page a new customer goes through, in order. The sign-up, workspace and log-in pages open as a preview in a new tab, so nothing you type there is saved.</s-paragraph>
          <s-stack direction="inline" gap="small">
            <s-button href="/signup?preview" target="_blank">1. Sign-up page</s-button>
            <s-button href="/welcome?preview" target="_blank">2. Workspace details</s-button>
            <s-button href="/app/setup">3. Setup wizard</s-button>
            <s-button href="/app">4. Overview</s-button>
            <s-button href="/login?preview" target="_blank">Log-in page</s-button>
          </s-stack>
          <s-paragraph>
            To go through it for real as a customer, invite a test email below (for example yourname+test@yourdomain), then open the sign-up page in a private browser window and sign up
            with it. To try just the workspace and Setup steps on your own login, <s-link href="/welcome?new">add a test workspace</s-link>; you can switch back from the
            workspace menu.
          </s-paragraph>
        </s-stack>
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

      <s-section heading="Create an account for a client">
        <Form method="post">
          <input type="hidden" name="intent" value="client" />
          <s-stack gap="base">
            <s-paragraph>Sets up a login and a workspace for a client, so you can get it ready for them. They choose their own password from the link, or sign in with Google using the same email.</s-paragraph>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
              <s-email-field name="email" label="Client's email" placeholder="name@theirstore.com" required />
              <s-text-field name="name" label="Their name (optional)" />
              <s-text-field name="workspace" label="Workspace name" placeholder="Their business name" required />
              <s-text-field name="website" label="Website (optional)" placeholder="theirstore.com" />
            </s-grid>
            <s-checkbox name="send" label="Email them a link to log in" defaultChecked />
            <s-checkbox name="free" label="Free access (every page, nothing to pay)" />
            <s-stack direction="inline">
              <s-button type="submit" variant="primary" disabled={busy}>
                Create account
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={`Workspaces (${workspaces.length})`}>
        <s-paragraph>Open a workspace to see it as its owner does and help them. You stay logged in as yourself, and a bar at the top shows you&apos;re in their account.</s-paragraph>
        <s-table>
          <s-table-header-row>
            <s-table-header>Workspace</s-table-header>
            <s-table-header>Plan</s-table-header>
            <s-table-header>People</s-table-header>
            <s-table-header>Created</s-table-header>
            <s-table-header>Free access</s-table-header>
            <s-table-header>Support</s-table-header>
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
                <s-table-cell>
                  <SupportButton workspaceId={w.id} label="Open" busy={busy} />
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

function SupportButton({ workspaceId, label, busy }: { workspaceId: string; label: string; busy: boolean }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="support" />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <s-button type="submit" variant="secondary" icon="external" disabled={busy}>
        {label}
      </s-button>
    </Form>
  );
}
