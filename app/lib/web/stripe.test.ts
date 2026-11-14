import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import db from "../../db.server";
import { choosePlan, formEncode, syncSubscription, verifyWebhook } from "./stripe.server";
import { workspaceSubscriptions } from "./context.server";

// A pretend Stripe: answers by path and keeps what was sent.
function fakeStripe(answers: Record<string, unknown>) {
  const calls: { method: string; path: string; body: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname.replace("/v1", ""), body: decodeURIComponent(String(init.body ?? u.search)) });
    const key = Object.keys(answers).find((k) => `${init.method} ${u.pathname.replace("/v1", "")}`.startsWith(k));
    return new Response(JSON.stringify(key ? answers[key] : {}), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

async function workspace(data: Record<string, unknown> = {}) {
  const id = `w${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  return db.workspace.create({ data: { name: "Candle Co", shop: `ws-${id}.web.similarwise`, ...data } });
}

describe("Stripe billing for web workspaces", () => {
  it("encodes nested parameters the way Stripe reads them", () => {
    const q = formEncode({ line_items: [{ price: "p_1", quantity: 1 }], subscription_data: { metadata: { workspaceId: "w" } }, skip: undefined });
    expect([...q].map(([k, v]) => `${k}=${v}`)).toEqual(["line_items[0][price]=p_1", "line_items[0][quantity]=1", "subscription_data[metadata][workspaceId]=w"]);
  });

  it("only trusts webhooks signed with the secret", () => {
    const now = Date.now();
    const t = Math.floor(now / 1000);
    const sig = createHmac("sha256", "whsec_x").update(`${t}.{"a":1}`).digest("hex");
    expect(verifyWebhook('{"a":1}', `t=${t},v1=${sig}`, "whsec_x", now)).toBe(true);
    expect(verifyWebhook('{"a":2}', `t=${t},v1=${sig}`, "whsec_x", now)).toBe(false);
    expect(verifyWebhook('{"a":1}', `t=${t},v1=${sig}`, "whsec_x", now + 10 * 60_000)).toBe(false);
    expect(verifyWebhook('{"a":1}', null, "whsec_x", now)).toBe(false);
  });

  it("sends a new subscriber to Checkout, carrying over what's left of the trial", async () => {
    const now = new Date();
    const ws = await workspace({ trialEndsAt: new Date(now.getTime() + 5 * 86_400_000) });
    const { f, calls } = fakeStripe({
      "GET /prices": { data: [] },
      "POST /prices": { id: "price_grow_y" },
      "POST /customers": { id: "cus_1" },
      "POST /checkout/sessions": { url: "https://checkout.stripe.com/c/pay/x" },
    });
    expect(await choosePlan(ws.id, "a@example.com", "Grow (yearly)", f, now)).toBe("https://checkout.stripe.com/c/pay/x");
    const price = calls.find((c) => c.method === "POST" && c.path === "/prices")!.body;
    expect(price).toContain("unit_amount=178800");
    expect(price).toContain("recurring[interval]=year");
    const checkout = calls.find((c) => c.path === "/checkout/sessions")!.body;
    expect(checkout).toContain("customer=cus_1");
    expect(checkout).toContain(`subscription_data[trial_end]=${Math.floor(ws.trialEndsAt!.getTime() / 1000)}`);
    expect((await db.workspace.findUnique({ where: { id: ws.id } }))?.stripeCustomerId).toBe("cus_1");
  });

  it("opens the plan's pages once Stripe says the subscription is live, and closes them when it ends", async () => {
    const ws = await workspace({ stripeCustomerId: `cus_${Date.now()}` });
    const sub = (status: string) => ({
      id: `sub_${ws.id}`,
      status,
      customer: ws.stripeCustomerId!,
      metadata: { workspaceId: ws.id },
      items: { data: [{ id: "si_1", current_period_end: 1893456000, price: { id: "price_1", lookup_key: "similarwise_advertise_monthly" } }] },
    });
    await syncSubscription(sub("active"));
    expect((await workspaceSubscriptions(ws.id))[0]).toMatchObject({ name: "Advertise (monthly)", id: `sub_${ws.id}` });
    await syncSubscription(sub("canceled"));
    expect(await workspaceSubscriptions(ws.id)).toEqual([]);
  });
});
