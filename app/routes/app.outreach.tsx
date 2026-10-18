import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { claudeJson } from "../lib/ideas/claude.server";
import {
  deleteOutreach,
  editOutreach,
  outreachList,
  setOutreachStatus,
  startOutreach,
  startTopOutreach,
  writeFollowUp,
} from "../lib/links/outreach.server";

// Outreach emails to the sites in the link gap, sent from the merchant's own
// mailbox, with where each one got to.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { on: claudeJson() != null, emails: await outreachList(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const text = (k: string) => String(form.get(k) ?? "");
  try {
    if (intent === "batch") return { intent, ...(await startTopOutreach(shop)) };
    if (intent === "start") return { intent, ...(await startOutreach(shop, text("domain"))) };
    if (intent === "followUp") return { intent, id, ...(await writeFollowUp(shop, id)) };
  } catch (err) {
    console.error("Couldn't write outreach", shop, err);
    return { intent, id, error: "Couldn't write that just now. Try again in a minute." };
  }
  if (intent === "delete") {
    await deleteOutreach(shop, id);
    return { intent, id, ok: true as const };
  }
  if (intent === "save" || intent === "send") {
    const saved = await editOutreach(shop, id, { to: text("to"), subject: text("subject"), body: text("body") });
    if ("error" in saved || intent === "save") return { intent, id, ...saved };
    return { intent, id, ...(await setOutreachStatus(shop, id, "sent")) };
  }
  if (intent === "status") return { intent, id, ...(await setOutreachStatus(shop, id, text("status"))) };
  return { error: "Unknown action" };
};

type Email = ReturnType<typeof useLoaderData<typeof loader>>["emails"][number];

const GROUPS = [
  { status: "draft", heading: "Ready to send" },
  { status: "sent", heading: "Waiting for a reply" },
  { status: "replied", heading: "Replied" },
  { status: "linked", heading: "Linked to you" },
  { status: "declined", heading: "Not interested" },
] as const;

const BADGE = {
  draft: ["neutral", "Not sent"],
  sent: ["info", "Sent"],
  replied: ["warning", "Replied"],
  linked: ["success", "Linked to you"],
  declined: ["critical", "Not interested"],
} as const;

export default function Outreach() {
  const { on, emails } = useLoaderData<typeof loader>();
  const batch = useFetcher<typeof action>();
  const result = batch.state === "idle" ? batch.data : undefined;
  const count = (s: string) => emails.filter((e) => e.status === s).length;

  return (
    <s-page heading="Outreach emails">
      {on && (
        <s-button slot="primary-action" variant="primary" loading={batch.state !== "idle"} onClick={() => batch.submit({ intent: "batch" }, { method: "post" })}>
          Write emails for the next 5 sites
        </s-button>
      )}
      {!on && <s-banner tone="info">Outreach emails aren&apos;t switched on for this app yet.</s-banner>}
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Emails asking the sites in your <s-link href="/app/links">link gap</s-link> to link to you. Each one is written for that site, and its
            contact address is found on its own pages where it can be. Send each from your own email, so replies come straight to you, then mark
            how it went. A follow-up is suggested after a week with no reply.
          </s-paragraph>
          {batch.state !== "idle" && <s-text color="subdued">Reading the sites and writing the emails takes a minute or two.</s-text>}
          {result && "error" in result && <s-banner tone="warning">{result.error}</s-banner>}
          {result && "count" in result && <s-banner tone="success">{result.count} emails written. They&apos;re under Ready to send.</s-banner>}
          {emails.length > 0 && (
            <div className="sw-stats">
              {GROUPS.map((g) => (
                <div key={g.status} className="sw-stat">
                  <strong>{count(g.status)}</strong>
                  <span>{g.heading}</span>
                </div>
              ))}
            </div>
          )}
          {emails.length === 0 && on && <s-paragraph>No emails yet. Press Write emails for the next 5 sites, or Write email on a site in your link gap.</s-paragraph>}
        </s-stack>
      </s-section>

      {GROUPS.map((g) => {
        const group = emails.filter((e) => e.status === g.status);
        return group.length ? (
          <s-section key={g.status} heading={`${g.heading} (${group.length})`}>
            <s-stack gap="base">
              {group.map((e) => (
                <EmailCard key={`${e.id}-${e.subject}`} e={e} />
              ))}
            </s-stack>
          </s-section>
        ) : null;
      })}
      <style>{CSS}</style>
    </s-page>
  );
}

function EmailCard({ e }: { e: Email }) {
  const act = useFetcher<typeof action>();
  const [draft, setDraft] = useState({ to: e.to ?? "", subject: e.subject, body: e.body });
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = (intent: string) => act.state !== "idle" && act.formData?.get("intent") === intent;
  const error = act.state === "idle" && act.data && "error" in act.data ? act.data.error : null;
  const status = e.status as keyof typeof BADGE;
  const [tone, label] = BADGE[status] ?? BADGE.draft;
  const change = (k: keyof typeof draft) => (ev: Event) => {
    setDraft({ ...draft, [k]: (ev.currentTarget as HTMLInputElement).value });
    setDirty(true);
  };
  const mailto = `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  const status_ = (s: string) => act.submit({ intent: "status", id: e.id, status: s }, { method: "post" });
  if (busy("delete")) return null;

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-link href={`https://${e.domain}`} target="_blank">
            {e.domain}
          </s-link>
          <s-badge tone={tone}>{label}</s-badge>
          {e.followUpDue && <s-badge tone="caution">Follow up now</s-badge>}
          {e.followUps > 0 && <s-text color="subdued">{e.followUps === 1 ? "1 follow-up" : `${e.followUps} follow-ups`}</s-text>}
          {e.lastSentAt && <s-text color="subdued">Last sent {new Date(e.lastSentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</s-text>}
        </s-stack>
        {e.siteTitle && <s-text color="subdued">{e.siteTitle}</s-text>}
        {error && <s-banner tone="warning">{error}</s-banner>}

        <s-email-field
          label="To"
          value={draft.to}
          placeholder="No address found on the site. Check its contact page."
          details={e.emails.length > 1 ? `Also found on the site: ${e.emails.filter((x) => x !== draft.to).join(", ")}` : undefined}
          onInput={change("to")}
        />
        <s-text-field label="Subject" value={draft.subject} onInput={change("subject")} />
        <s-text-area label="Email" value={draft.body} rows={8} onInput={change("body")} />

        <s-stack direction="inline" gap="small" alignItems="center">
          {e.status === "draft" && (
            <s-button
              variant="primary"
              href={mailto}
              target="_blank"
              disabled={!draft.to}
              onClick={() => act.submit({ intent: "send", id: e.id, ...draft }, { method: "post" })}
            >
              Open in your email
            </s-button>
          )}
          <s-button
            variant="tertiary"
            onClick={() => {
              void navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy email"}
          </s-button>
          {dirty && (
            <s-button
              loading={busy("save")}
              onClick={() => {
                act.submit({ intent: "save", id: e.id, ...draft }, { method: "post" });
                setDirty(false);
              }}
            >
              Save changes
            </s-button>
          )}
          {e.status === "draft" && (
            <s-button variant="tertiary" onClick={() => status_("sent")}>
              I&apos;ve sent it
            </s-button>
          )}
          {e.status === "sent" && (
            <>
              <s-button onClick={() => status_("replied")}>They replied</s-button>
              <s-button onClick={() => status_("linked")}>They linked to me</s-button>
              <s-button variant="tertiary" onClick={() => status_("declined")}>
                Not interested
              </s-button>
              {e.followUps < 2 && (
                <s-button variant={e.followUpDue ? "primary" : "tertiary"} loading={busy("followUp")} onClick={() => act.submit({ intent: "followUp", id: e.id }, { method: "post" })}>
                  Write a follow-up
                </s-button>
              )}
            </>
          )}
          {e.status === "replied" && (
            <>
              <s-button onClick={() => status_("linked")}>They linked to me</s-button>
              <s-button variant="tertiary" onClick={() => status_("declined")}>
                Not interested
              </s-button>
            </>
          )}
          {(e.status === "linked" || e.status === "declined") && (
            <s-button variant="tertiary" onClick={() => status_("sent")}>
              Move back to waiting
            </s-button>
          )}
          <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "delete", id: e.id }, { method: "post" })}>
            Delete
          </s-button>
        </s-stack>
        {e.status === "draft" && !draft.to && <s-text color="subdued">Add an address to open it in your email, or copy it into a contact form on the site.</s-text>}
      </s-stack>
    </s-box>
  );
}

const CSS = `
.sw-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.sw-stat { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid #e3e3e3; border-radius: 10px; background: #fff; font-size: 12px; color: #616161; }
.sw-stat strong { font-size: 20px; color: #303030; }
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
