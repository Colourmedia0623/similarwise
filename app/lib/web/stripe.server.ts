import { createHmac, timingSafeEqual } from "node:crypto";
import db from "../../db.server";
import { PLANS, parsePlanKey, planKey, type Cycle, type Tier } from "../billing";

// Billing for web workspaces through Stripe: the same three plans and prices
// as on Shopify, paid by card. The products and prices are made in Stripe the
// first time they're needed (found again by lookup key), so the only setup is
// STRIPE_SECRET_KEY and, for the webhook at /webhooks/stripe,
// STRIPE_WEBHOOK_SECRET.

type Fetch = typeof fetch;
const API = "https://api.stripe.com/v1";

export const stripeOn = () => !!process.env.STRIPE_SECRET_KEY;

// Stripe's form encoding: { a: { b: [1] } } → a[b][0]=1
export function formEncode(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? formEncode(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") formEncode(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}, f: Fetch = fetch): Promise<T> {
  const body = formEncode(params);
  const url = method === "GET" && [...body].length ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await f(url, {
    method,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY ?? ""}`, "content-type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
  return json;
}

const lookupKey = (tier: Tier, cycle: Cycle) => `similarwise_${tier}_${cycle}`;

function planFromLookup(key: string | null | undefined) {
  const m = /^similarwise_(watch|grow|advertise)_(monthly|yearly)$/.exec(key ?? "");
  return m ? planKey(m[1] as Tier, m[2] as Cycle) : null;
}

const priceCache = new Map<string, string>();

// The Stripe price for a plan, made the first time it's asked for.
export async function priceFor(tier: Tier, cycle: Cycle, f: Fetch = fetch) {
  const key = lookupKey(tier, cycle);
  const cached = priceCache.get(key);
  if (cached) return cached;
  const found = await stripe<{ data: { id: string }[] }>("GET", "/prices", { lookup_keys: [key], active: true, limit: 1 }, f);
  let id = found.data[0]?.id;
  if (!id) {
    const plan = PLANS.find((p) => p.tier === tier)!;
    const price = await stripe<{ id: string }>(
      "POST",
      "/prices",
      {
        lookup_key: key,
        currency: "usd",
        unit_amount: (cycle === "yearly" ? plan.yearly * 12 : plan.monthly) * 100,
        recurring: { interval: cycle === "yearly" ? "year" : "month" },
        product_data: { name: `SimilarWise ${plan.name}` },
        metadata: { tier, cycle },
      },
      f,
    );
    id = price.id;
  }
  priceCache.set(key, id);
  return id;
}

type Subscription = {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number;
  trial_end?: number | null;
  cancel_at_period_end?: boolean;
  metadata?: { workspaceId?: string };
  items: { data: { id: string; current_period_end?: number; price: { id: string; lookup_key: string | null } }[] };
};

// Copies a subscription's plan and status onto its workspace.
export async function syncSubscription(sub: Subscription) {
  const ws =
    (await db.workspace.findUnique({ where: { stripeSubscriptionId: sub.id } })) ??
    (sub.metadata?.workspaceId ? await db.workspace.findUnique({ where: { id: sub.metadata.workspaceId } }) : null) ??
    (await db.workspace.findUnique({ where: { stripeCustomerId: sub.customer } }));
  if (!ws) return null;
  // A newer subscription replaces an ended one, but an old one ending doesn't clear a newer one.
  if (ws.stripeSubscriptionId && ws.stripeSubscriptionId !== sub.id && ["canceled", "incomplete_expired"].includes(sub.status)) return ws;
  const item = sub.items.data[0];
  const end = sub.trial_end && sub.status === "trialing" ? sub.trial_end : (item?.current_period_end ?? sub.current_period_end);
  return db.workspace.update({
    where: { id: ws.id },
    data: {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer,
      plan: planFromLookup(item?.price.lookup_key),
      planStatus: sub.status,
      periodEndsAt: end ? new Date(end * 1000) : null,
      ...(["active", "trialing"].includes(sub.status) ? { trialEndsAt: null } : {}),
    },
  });
}

export const fetchSubscription = (id: string, f: Fetch = fetch) => stripe<Subscription>("GET", `/subscriptions/${id}`, {}, f);

async function customerFor(ws: { id: string; name: string; stripeCustomerId: string | null }, email: string, f: Fetch) {
  if (ws.stripeCustomerId) return ws.stripeCustomerId;
  const c = await stripe<{ id: string }>("POST", "/customers", { email, name: ws.name, metadata: { workspaceId: ws.id } }, f);
  await db.workspace.update({ where: { id: ws.id }, data: { stripeCustomerId: c.id } });
  return c.id;
}

const appUrl = () => process.env.SHOPIFY_APP_URL || "";

// Starts a plan or changes it. Returns where to send the browser.
export async function choosePlan(workspaceId: string, email: string, plan: string, f: Fetch = fetch, now = new Date()) {
  const parsed = parsePlanKey(plan);
  if (!parsed) throw new Error("Unknown plan");
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const price = await priceFor(parsed.tier, parsed.cycle, f);

  // Already paying: switch the plan in place, with the difference prorated.
  if (ws.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(ws.planStatus ?? "")) {
    const sub = await fetchSubscription(ws.stripeSubscriptionId, f);
    const updated = await stripe<Subscription>(
      "POST",
      `/subscriptions/${sub.id}`,
      { items: [{ id: sub.items.data[0].id, price }], proration_behavior: "create_prorations", cancel_at_period_end: false },
      f,
    );
    await syncSubscription(updated);
    return "/app/plans?billing=changed";
  }

  const customer = await customerFor(ws, email, f);
  // Whatever is left of the free trial carries over (Stripe needs two days or more).
  const trialLeft = ws.trialEndsAt ? ws.trialEndsAt.getTime() - now.getTime() : 0;
  const session = await stripe<{ url: string }>(
    "POST",
    "/checkout/sessions",
    {
      mode: "subscription",
      customer,
      client_reference_id: ws.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        metadata: { workspaceId: ws.id },
        trial_end: trialLeft > 2.1 * 86_400_000 ? Math.floor(ws.trialEndsAt!.getTime() / 1000) : undefined,
      },
      allow_promotion_codes: true,
      customer_update: { name: "auto", address: "auto" },
      automatic_tax: process.env.STRIPE_TAX === "on" ? { enabled: true } : undefined,
      success_url: `${appUrl()}/app/plans?billing=done&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/app/plans`,
    },
    f,
  );
  return session.url;
}

// After Checkout, so the plan shows straight away even before the webhook arrives.
export async function finishCheckout(workspaceId: string, sessionId: string, f: Fetch = fetch) {
  const session = await stripe<{ client_reference_id: string | null; subscription: string | null }>("GET", `/checkout/sessions/${sessionId}`, {}, f);
  if (session.client_reference_id !== workspaceId || !session.subscription) return;
  await syncSubscription(await fetchSubscription(session.subscription, f));
}

// Stripe's own page for cards, invoices and cancelling.
export async function portalUrl(workspaceId: string, f: Fetch = fetch) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (!ws.stripeCustomerId) return null;
  const s = await stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: ws.stripeCustomerId, return_url: `${appUrl()}/app/plans` }, f);
  return s.url;
}

// Checks a webhook's Stripe-Signature header (t=…,v1=…) and its age.
export function verifyWebhook(payload: string, header: string | null, secret = process.env.STRIPE_WEBHOOK_SECRET ?? "", now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const got = Buffer.from(p.slice(3));
      return got.length === want.length && timingSafeEqual(got, want);
    });
}
