import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Similarwise</h1>
        <p className={styles.text}>
          Competitor intelligence for Shopify brands, right inside your Shopify admin.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Track your rivals</strong>. Add the stores you compete with and Similarwise checks them every day.
          </li>
          <li>
            <strong>See every change</strong>. New products, price cuts and rises, and products taken down.
          </li>
          <li>
            <strong>Know where they advertise</strong>. See the ad platforms, apps and theme each competitor uses.
          </li>
        </ul>
        <p>
          <a href="/privacy">Privacy policy</a>
        </p>
      </div>
    </div>
  );
}
