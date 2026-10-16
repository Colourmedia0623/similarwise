import type { MetaFunction } from "react-router";

// The public privacy policy, linked from the App Store listing and the
// landing page. Keep it in step with what the app stores (prisma/schema.prisma).

const CONTACT = "info@colourmedia.net";
const UPDATED = "16 October 2026";

export const meta: MetaFunction = () => [{ title: "Similarwise privacy policy" }];

const page: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "2rem 1rem 4rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
  lineHeight: 1.6,
  color: "#1a1a1a",
};

export default function Privacy() {
  return (
    <main style={page}>
      <h1>Similarwise privacy policy</h1>
      <p>Last updated {UPDATED}.</p>

      <p>
        Similarwise is a Shopify app made by Colourmedia. It tracks the public storefronts of competitor stores a
        merchant chooses. This policy explains what information Similarwise handles when a shop installs it, why,
        and how long it is kept.
      </p>

      <h2>Information from the shop</h2>
      <p>When a merchant installs Similarwise, the app keeps:</p>
      <ul>
        <li>the shop&apos;s domain and the access Shopify grants the app, so it can show its pages in the admin;</li>
        <li>the list of competitor websites the merchant adds.</li>
      </ul>
      <p>Similarwise does not store any information about the shop&apos;s customers or orders.</p>

      <h2>Information about competitor stores</h2>
      <p>
        For each competitor, Similarwise reads only public pages anyone can visit: the home page (for the theme, apps
        and tracking pixels it loads) and, for Shopify stores, the public product catalogue (product names, prices and
        publish dates). It keeps a history of those details so it can show what changed. It holds no personal
        information from those stores.
      </p>

      <h2>How long it is kept</h2>
      <p>
        When a merchant removes a competitor, its history is deleted at once. When a shop uninstalls Similarwise,
        Shopify tells the app 48 hours later and everything held for that shop is deleted.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </main>
  );
}
