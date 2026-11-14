import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { inboxWebhook } from "../lib/inbox/inbox.server";

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

export function signedByMeta(body: string, header: string | null, secret = process.env.META_APP_SECRET ?? "") {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

// The Page or Instagram account ids the note is about.
export function webhookIds(body: string): string[] {
  try {
    const json = JSON.parse(body) as { object?: string; entry?: { id?: string }[] };
    if (json.object !== "page" && json.object !== "instagram") return [];
    return [...new Set((json.entry ?? []).map((e) => e.id).filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)))];
  } catch {
    return [];
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const body = await request.text();
  if (!signedByMeta(body, request.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  // Answered at once; the read happens after, as Meta wants a reply within a few seconds.
  await inboxWebhook(webhookIds(body));
  return new Response("OK", { status: 200 });
};
