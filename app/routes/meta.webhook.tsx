import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { inboxWebhook } from "../lib/inbox/inbox.server";
import { signedByMeta, webhookIds } from "../lib/inbox/webhook.server";

// Meta's webhook for the social inbox, at /meta/webhook. Meta sends a note
// here whenever a connected Page or Instagram account gets a new comment or
// message, and the inbox reads it straight away.
//
// In the Meta app, set the callback URL to <app address>/meta/webhook and the
// verify token to META_WEBHOOK_TOKEN (or "similarwise-inbox" when that isn't
// set). The token only proves the address to Meta: every note is signed with
// the app secret (META_APP_SECRET), and unsigned ones are turned away.

// Meta checks the address once when it's added: it echoes back the challenge.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const q = new URL(request.url).searchParams;
  const token = process.env.META_WEBHOOK_TOKEN || "similarwise-inbox";
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token) return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const body = await request.text();
  if (!signedByMeta(body, request.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  // Answered at once; the read happens after, as Meta wants a reply within a few seconds.
  await inboxWebhook(webhookIds(body));
  return new Response("OK", { status: 200 });
};
