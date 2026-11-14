import type { ReactNode } from "react";
import styles from "./auth.module.css";

// The frame around the website's login, sign-up and setup pages: the form on
// one side, and what SimilarWise does on the other.

const POINTS = [
  { title: "Every competitor move", text: "Prices, launches, stock, ads and traffic, checked daily." },
  { title: "Win their searches", text: "Keyword gaps, rank tracking and ready-written blog posts." },
  { title: "Social on autopilot", text: "Plan, post and answer comments across every network." },
];

export function AuthPage({ title, lead, children, footer }: { title: string; lead?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-hidden="true">
        <div className={styles.orbA} />
        <div className={styles.orbB} />
        <a className={styles.heroBrand} href="/">
          <img src="/icon-512.png" alt="" />
          SimilarWise
        </a>
        <div className={styles.heroBody}>
          <h2>
            See what your competitors do. <span>Then do it better.</span>
          </h2>
          <ul>
            {POINTS.map((p) => (
              <li key={p.title}>
                <span className={styles.tick}>✓</span>
                <span>
                  <strong>{p.title}</strong>
                  {p.text}
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.glass}>
            <div className={styles.glassRow}>
              <span>Competitor price drop</span>
              <b className={styles.down}>−12%</b>
            </div>
            <div className={styles.glassRow}>
              <span>New Meta ads spotted</span>
              <b>+4</b>
            </div>
            <div className={styles.glassRow}>
              <span>Keyword gap found</span>
              <b className={styles.up}>2.4k/mo</b>
            </div>
          </div>
        </div>
        <p className={styles.heroFoot}>For Shopify, WooCommerce, Wix and any website.</p>
      </section>
      <section className={styles.formSide}>
        <a className={styles.brand} href="/">
          <img src="/icon-512.png" alt="" />
          SimilarWise
        </a>
        <div className={styles.card}>
          <h1>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
          {children}
        </div>
        {footer}
      </section>
    </main>
  );
}

export function GoogleButton({ href, label }: { href: string; label: string }) {
  return (
    <a className={styles.google} href={href}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {label}
    </a>
  );
}

export { styles as authStyles };
