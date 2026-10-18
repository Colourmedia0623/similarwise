import type { MetaFunction } from "react-router";

// The public terms of service, linked from the Facebook and TikTok app
// listings next to the privacy policy.

const CONTACT = "info@colourmedia.net";
const UPDATED = "18 October 2026";

export const meta: MetaFunction = () => [{ title: "Similarwise terms of service" }];

const page: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "2rem 1rem 4rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
  lineHeight: 1.6,
  color: "#1a1a1a",
};

export default function Terms() {
  return (
    <main style={page}>
      <h1>Similarwise terms of service</h1>
      <p>Last updated {UPDATED}.</p>

      <p>
        Similarwise is a Shopify app made by Colourmedia. By installing it, or by connecting a Facebook, Instagram or TikTok account to it, you agree to
        these terms.
      </p>

      <h2>What Similarwise does</h2>
      <p>
        Similarwise tracks the public storefronts of competitor stores you choose, suggests keywords and content, writes blog articles for your shop, and
        shares those articles to the social accounts you connect. Estimates of traffic, rankings and ad spend come from third parties and may not be exact.
      </p>

      <h2>Your accounts and content</h2>
      <ul>
        <li>You must be allowed to manage the Shopify store and every social account you connect.</li>
        <li>
          Similarwise posts to a social account only when you share an article, or when you turn on automatic sharing for the content calendar. You can
          disconnect an account at any time.
        </li>
        <li>
          You are responsible for what is published on your blog and social accounts, including articles, pictures and captions Similarwise writes for you.
          Read them before they go out, or turn automatic publishing off.
        </li>
        <li>Follow the rules of each network you post to, including Meta&apos;s and TikTok&apos;s terms and community guidelines.</li>
      </ul>

      <h2>Fair use</h2>
      <p>
        Don&apos;t use Similarwise to break the law, to post spam or misleading content, or to try to get around the limits of the services it connects to.
        We may suspend access if it is misused.
      </p>

      <h2>Billing</h2>
      <p>Any charges are billed through Shopify and shown to you before you agree to them.</p>

      <h2>No warranty</h2>
      <p>
        Similarwise is provided as it is. We work to keep it accurate and available, but we can&apos;t promise it will always be, and we aren&apos;t liable
        for indirect losses from using it, as far as the law allows.
      </p>

      <h2>Privacy</h2>
      <p>
        How we handle information is set out in our <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. The date at the top shows when they last changed.</p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </main>
  );
}
