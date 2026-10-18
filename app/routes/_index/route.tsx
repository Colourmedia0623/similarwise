import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { login } from "../../shopify.server";
import { FEATURES, MAX_FEATURES, PRICE, REVENUE, TRACKING, parseSurvey, type Option } from "../../lib/survey";
import { saveSurvey } from "../../lib/survey.server";

import styles from "./styles.module.css";

// The public landing page: what Similarwise does, and the early-access survey
// merchants fill in to join the waitlist.

export const meta: MetaFunction = () => [
  { title: "Similarwise: competitor intelligence for Shopify brands" },
  {
    name: "description",
    content: "See your competitors' products, prices, ads and search traffic, right inside your Shopify admin.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  // Hidden from people; bots that fill every field get a quiet "thanks".
  if (form.get("website")) return { ok: true as const };
  const parsed = parseSurvey(form);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  await saveSurvey(parsed.answers);
  return { ok: true as const };
};

const POINTS = [
  {
    title: "Every product and price",
    body: "Add the stores you compete with. Similarwise checks them daily and shows new launches, price cuts and products taken down.",
  },
  {
    title: "Their search traffic",
    body: "How many visits they get from Google, the keywords they rank for and the ones they pay for.",
  },
  {
    title: "Where they advertise",
    body: "The ad platforms, apps and theme each competitor uses, and their estimated Google Ads spend.",
  },
  {
    title: "Inside Shopify",
    body: "No new tool to learn. It lives in your Shopify admin, at a fraction of the price of SimilarWeb.",
  },
];

function Choices({ name, options, type }: { name: string; options: Option[]; type: "radio" | "checkbox" }) {
  return (
    <div className={styles.choices}>
      {options.map((o) => (
        <label key={o.value} className={styles.choice}>
          <input type={type} name={name} value={o.value} required={type === "radio"} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const sending = useNavigation().state === "submitting";

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.brand}>Similarwise</p>
        <h1 className={styles.heading}>Know what your competitors are doing, without leaving Shopify</h1>
        <p className={styles.lead}>
          Products, prices, ads and search traffic for the stores you compete with, checked every day.
        </p>
        <a className={styles.cta} href="#early-access">
          Get early access
        </a>
      </header>

      <ul className={styles.points}>
        {POINTS.map((p) => (
          <li key={p.title}>
            <h2>{p.title}</h2>
            <p>{p.body}</p>
          </li>
        ))}
      </ul>

      <section id="early-access" className={styles.survey}>
        <h2>Get early access</h2>
        {result?.ok ? (
          <p className={styles.thanks}>
            Thanks, you&apos;re on the list. We&apos;ll email you when Similarwise opens to more stores.
          </p>
        ) : (
          <Form method="post" className={styles.form}>
            <p>Five quick questions help us build the right thing first. It takes about a minute.</p>

            <label className={styles.field}>
              <span>Email</span>
              <input type="email" name="email" required autoComplete="email" />
            </label>
            <label className={styles.field}>
              <span>Your store&apos;s website (optional)</span>
              <input type="text" name="store" placeholder="yourstore.com" />
            </label>
            <label className={styles.hidden} aria-hidden="true">
              Website
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>

            <fieldset>
              <legend>1. Roughly how much does your store sell a year?</legend>
              <Choices name="revenue" options={REVENUE} type="radio" />
            </fieldset>
            <fieldset>
              <legend>2. How do you keep an eye on competitors today?</legend>
              <Choices name="tracking" options={TRACKING} type="checkbox" />
            </fieldset>
            <fieldset>
              <legend>3. Which would help you most? Pick up to {MAX_FEATURES}.</legend>
              <Choices name="features" options={FEATURES} type="checkbox" />
            </fieldset>
            <fieldset>
              <legend>4. If it did those well, what would you pay?</legend>
              <Choices name="price" options={PRICE} type="radio" />
            </fieldset>
            <label className={styles.field}>
              <span>5. What would you most like to know about a competitor? (optional)</span>
              <textarea name="question" rows={3} />
            </label>

            {result && !result.ok && <p className={styles.error}>{result.error}</p>}
            <button className={styles.cta} type="submit" disabled={sending}>
              {sending ? "Sending…" : "Join the waitlist"}
            </button>
          </Form>
        )}
      </section>

      <footer className={styles.footer}>
        {showForm && (
          <Form className={styles.login} method="post" action="/auth/login">
            <label>
              <span>Already installed? Log in with your shop domain</span>
              <input type="text" name="shop" placeholder="my-shop.myshopify.com" />
            </label>
            <button type="submit">Log in</button>
          </Form>
        )}
        <p>
          Made by Colourmedia. <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a>
        </p>
      </footer>
    </div>
  );
}
