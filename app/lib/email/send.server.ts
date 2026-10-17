import { createHmac, timingSafeEqual } from "node:crypto";

// Sends the app's emails through Resend. Off unless RESEND_API_KEY is set;
// EMAIL_FROM must be an address on a domain verified in Resend.

export type Email = { to: string; subject: string; html: string; text: string; unsubscribeUrl?: string };
export type Mailer = (email: Email) => Promise<void>;

export function mailer(): Mailer | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const from = process.env.EMAIL_FROM || "Similarwise <alerts@similarwise.colourmedia.net>";
  return async ({ to, subject, html, text, unsubscribeUrl }) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
        headers: unsubscribeUrl
          ? { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
          : undefined,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

export type EmailList = "alerts" | "digest";

const sign = (shop: string, list: EmailList) =>
  createHmac("sha256", process.env.SHOPIFY_API_SECRET || "dev").update(`${shop}:${list}`).digest("base64url");

// A link that turns one kind of email off without logging in.
export function unsubscribeUrl(shop: string, list: EmailList) {
  const q = new URLSearchParams({ shop, list, sig: sign(shop, list) });
  return `${process.env.SHOPIFY_APP_URL || ""}/email/unsubscribe?${q}`;
}

export function verifyUnsubscribe(shop: string, list: string, sig: string): list is EmailList {
  if (list !== "alerts" && list !== "digest") return false;
  const want = Buffer.from(sign(shop, list));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

// The app inside the shop's Shopify admin.
export function adminUrl(shop: string, path = "") {
  return `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/, "")}/apps/${process.env.SHOPIFY_API_KEY || ""}${path}`;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
