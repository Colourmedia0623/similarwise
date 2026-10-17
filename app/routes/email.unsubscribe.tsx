import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import db from "../db.server";
import { verifyUnsubscribe } from "../lib/email/send.server";

// The "turn this email off" link in every email. Mail apps can also post here
// directly (one-click unsubscribe), so the change happens on POST.

const LABEL = { alerts: "competitor alerts", digest: "the weekly summary" } as const;

function check(url: URL) {
  const shop = url.searchParams.get("shop") ?? "";
  const list = url.searchParams.get("list") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  return verifyUnsubscribe(shop, list, sig) ? { shop, list } : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const found = check(new URL(request.url));
  return found ? { valid: true as const, shop: found.shop, what: LABEL[found.list] } : { valid: false as const };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const found = check(new URL(request.url));
  if (!found) throw new Response("This link isn't valid.", { status: 400 });
  await db.shopSettings.updateMany({
    where: { shop: found.shop },
    data: found.list === "alerts" ? { alertsOn: false } : { digestOn: false },
  });
  return { done: true };
};

const page = { maxWidth: 520, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.5 };

export default function Unsubscribe() {
  const data = useLoaderData<typeof loader>();
  const done = useActionData<typeof action>()?.done;
  if (!data.valid)
    return (
      <main style={page}>
        <h1>This link isn&apos;t valid</h1>
        <p>You can change your emails in Similarwise, under Email alerts.</p>
      </main>
    );
  return (
    <main style={page}>
      <h1>{done ? "Done" : `Turn off ${data.what}?`}</h1>
      {done ? (
        <p>
          {data.shop} won&apos;t get {data.what} any more. You can turn them back on in Similarwise, under Email alerts.
        </p>
      ) : (
        <Form method="post">
          <p>For {data.shop}.</p>
          <button type="submit" style={{ padding: "10px 18px", font: "inherit" }}>
            Turn off {data.what}
          </button>
        </Form>
      )}
    </main>
  );
}
