import type { MetaFunction } from "react-router";

// How to have SimilarWise delete what it holds from Facebook, Instagram and
// TikTok. Meta asks for this page (Data deletion instructions URL) before an
// app can go live.

const CONTACT = "info@colourmedia.net";

export const meta: MetaFunction = () => [{ title: "Deleting your Similarwise data" }];

const page: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "2rem 1rem 4rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
  lineHeight: 1.6,
  color: "#1a1a1a",
};

export default function DataDeletion() {
  return (
    <main style={page}>
      <h1>Deleting your Similarwise data</h1>

      <p>
        When you connect a Facebook Page, Instagram account or TikTok account to Similarwise, it keeps the account&apos;s name and ID, the access the
        network gives it (encrypted), and a record of the posts you share through it. Here is how to have all of that deleted.
      </p>

      <h2>Disconnect the account in Similarwise</h2>
      <ol>
        <li>Open Similarwise in your Shopify admin.</li>
        <li>
          Go to <strong>Social accounts</strong>.
        </li>
        <li>
          Press <strong>Disconnect</strong> next to the account.
        </li>
      </ol>
      <p>The account and its access are deleted straight away.</p>

      <h2>Or remove Similarwise from the network</h2>
      <ul>
        <li>
          Facebook and Instagram: in Facebook, go to Settings and privacy, Settings, <strong>Business integrations</strong>, and remove Similarwise.
        </li>
        <li>
          TikTok: in the TikTok app, go to Settings and privacy, Security and permissions, <strong>Apps and services</strong>, and remove Similarwise.
        </li>
      </ul>
      <p>Similarwise can no longer post for you once access is removed. To have the stored details deleted as well, disconnect it as above or email us.</p>

      <h2>Uninstalling</h2>
      <p>If you uninstall Similarwise from Shopify, everything it holds for your shop, including every connected social account, is deleted when Shopify tells it, 48 hours later.</p>

      <h2>Ask us</h2>
      <p>
        Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> with your shop&apos;s address and we&apos;ll delete your data within 30 days and confirm when
        it&apos;s done.
      </p>

      <p>
        <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a>
      </p>
    </main>
  );
}
