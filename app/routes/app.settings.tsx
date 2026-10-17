import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { TOPICS, alertEmail, digestEmail, parseTopics, type Topic } from "../lib/email/alerts.server";
import { mailer } from "../lib/email/send.server";

// Where the app's emails go, and which ones the merchant wants.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const s = await db.shopSettings.findUnique({ where: { shop: session.shop } });
  return {
    emailOn: mailer() != null,
    email: s?.alertEmail ?? "",
    alertsOn: s?.alertsOn ?? true,
    digestOn: s?.digestOn ?? true,
    topics: parseTopics(s?.alertTopics ?? JSON.stringify(TOPICS.map((t) => t.key))),
    allTopics: TOPICS.map((t) => ({ key: t.key, label: t.label })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const shop = session.shop;
  if (form.get("intent") === "test") {
    const send = mailer();
    const s = await db.shopSettings.findUnique({ where: { shop } });
    if (!send || !s?.alertEmail) return { error: "Save an email address first." };
    const email =
      (await digestEmail(shop, s.alertEmail)) ??
      alertEmail(shop, s.alertEmail, [
        { kind: "launch", message: "This is a test alert from Similarwise.", createdAt: new Date(), competitor: { id: "test", name: "Similarwise" } },
      ]);
    try {
      await send({ ...email, subject: `Test: ${email.subject}` });
    } catch (err) {
      console.error("Test email failed", shop, err);
      return { error: "The email couldn't be sent. Try again in a minute." };
    }
    return { ok: true as const, sent: s.alertEmail };
  }
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "Enter a valid email address." };
  const topics = form.getAll("topics").map(String).filter((t): t is Topic => TOPICS.some((x) => x.key === t));
  const data = {
    alertEmail: email,
    alertsOn: form.get("alertsOn") === "on",
    digestOn: form.get("digestOn") === "on",
    alertTopics: JSON.stringify(topics),
  };
  const before = await db.shopSettings.findUnique({ where: { shop } });
  await db.shopSettings.upsert({
    where: { shop },
    // Alerts switched on start from now, not from every change since they were off.
    create: { shop, ...data, alertsSentAt: new Date() },
    update: { ...data, ...(data.alertsOn && !before?.alertsOn ? { alertsSentAt: new Date() } : {}) },
  });
  return { ok: true as const };
};

export default function Settings() {
  const loaded = useLoaderData<typeof loader>();
  const save = useFetcher<typeof action>();
  const test = useFetcher<typeof action>();
  const [email, setEmail] = useState(loaded.email);
  const [alertsOn, setAlertsOn] = useState(loaded.alertsOn);
  const [digestOn, setDigestOn] = useState(loaded.digestOn);
  const [topics, setTopics] = useState<string[]>(loaded.topics);
  const saveError = save.state === "idle" && save.data && "error" in save.data ? save.data.error : null;
  const testResult = test.state === "idle" ? test.data : undefined;

  const submit = () => {
    const form = new FormData();
    form.set("email", email);
    if (alertsOn) form.set("alertsOn", "on");
    if (digestOn) form.set("digestOn", "on");
    for (const t of topics) form.append("topics", t);
    save.submit(form, { method: "post" });
  };

  return (
    <s-page heading="Email alerts">
      {!loaded.emailOn && <s-banner tone="info">Emails aren&apos;t switched on for this app yet. Your choices are saved for when they are.</s-banner>}
      {saveError && <s-banner tone="critical">{saveError}</s-banner>}
      {save.state === "idle" && save.data && "ok" in save.data && <s-banner tone="success">Saved.</s-banner>}
      {testResult && "error" in testResult && <s-banner tone="critical">{testResult.error}</s-banner>}
      {testResult && "sent" in testResult && <s-banner tone="success">Test email sent to {testResult.sent}.</s-banner>}

      <s-section heading="Where to send them">
        <s-email-field label="Email address" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      </s-section>

      <s-section heading="Competitor alerts">
        <s-stack gap="base">
          <s-checkbox
            label="Email me when a competitor changes something"
            details="One email bundles everything found since the last one. Competitors are checked once a day."
            checked={alertsOn}
            onChange={(e) => setAlertsOn(e.currentTarget.checked)}
          />
          {alertsOn && (
            <s-stack gap="small">
              {loaded.allTopics.map((t) => (
                <s-checkbox
                  key={t.key}
                  label={t.label}
                  checked={topics.includes(t.key)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setTopics((cur) => (on ? [...cur, t.key] : cur.filter((x) => x !== t.key)));
                  }}
                />
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Weekly summary">
        <s-checkbox
          label="Email me a summary every Monday morning"
          details="The week's changes at each competitor, where they're cheaper than you, and the searches you're missing."
          checked={digestOn}
          onChange={(e) => setDigestOn(e.currentTarget.checked)}
        />
      </s-section>

      <s-section>
        <s-stack direction="inline" gap="small">
          <s-button variant="primary" loading={save.state !== "idle"} onClick={submit}>
            Save
          </s-button>
          {loaded.emailOn && (
            <s-button loading={test.state !== "idle"} onClick={() => test.submit({ intent: "test" }, { method: "post" })}>
              Send a test email
            </s-button>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
