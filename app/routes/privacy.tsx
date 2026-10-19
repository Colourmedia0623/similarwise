import type { MetaFunction } from "react-router";

// The public privacy policy, linked from the App Store listing and the
// landing page. Keep it in step with what the app stores (prisma/schema.prisma).

const CONTACT = "info@colourmedia.net";
const UPDATED = "17 October 2026";

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
        <li>the list of competitor websites the merchant adds;</li>
        <li>the names, prices and types of the shop&apos;s active products, to compare them with competitors&apos;;</li>
        <li>the shop&apos;s country and website address, to compare its Google search rankings with competitors&apos;;</li>
        <li>
          the email address alerts and the weekly summary go to (the shop&apos;s own address unless the merchant changes
          it). These emails are sent through Resend, and every one has a link to turn it off.
        </li>
      </ul>
      <p>Similarwise does not store any information about the shop&apos;s customers or orders.</p>

      <h2>Information about competitor stores</h2>
      <p>
        For each competitor, Similarwise reads only public pages anyone can visit: the home page (for the theme, apps
        and tracking pixels it loads) and, for Shopify stores, the public product catalogue (product names, prices and
        publish dates). It keeps a history of those details so it can show what changed. It holds no personal
        information from those stores. It reads the shop&apos;s own home page the same way, to set its theme and apps
        beside its competitors&apos;.
      </p>
      <p>
        Estimates of Google search traffic, keywords and ad spend come from DataForSEO. Similarwise sends it only
        website addresses (the competitors&apos; and the shop&apos;s own) and the country to look at.
      </p>
      <p>
        Competitors&apos; ads come from the public Meta, TikTok and Google ad libraries, through Scrape Creators. Figures on where competitors&apos; visits come from are Similarweb&apos;s public estimates, read through Apify. Sites linking to competitors come from DataForSEO Backlinks. Keyword ideas, ad ideas, blog articles and outreach emails are written by Anthropic&apos;s Claude from the keyword gap, competitors&apos; public ads and your product titles; no customer data is sent. Outreach emails use what the linking sites show publicly on their own pages, including any contact address there; SimilarWise never sends them, the merchant does from their own email. When the merchant connects Facebook, Instagram or TikTok, SimilarWise keeps the access those networks give it, encrypted, and uses it only to post the articles the merchant shares, or the content calendar&apos;s articles when they turn that on. Disconnecting an account, or uninstalling the app, deletes it. When the merchant connects their Google account, SimilarWise keeps the access Google gives it, encrypted, and uses it only to read the merchant&apos;s own Google Analytics and Google Ads figures (visits, traffic sources, landing pages, orders and sales; ad spend, clicks, conversions and campaigns) to show them in the app. It never changes anything in those accounts, never reads data about individual visitors, and never shares, sells or uses this data for advertising or to train AI models. SimilarWise&apos;s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Disconnecting Google, or uninstalling the app, deletes the access and the figures. For AI mentions, the shop&apos;s questions are asked of ChatGPT, Gemini and Perplexity through DataForSEO; only the questions themselves are sent. Pictures for blog articles are made by OpenAI&apos;s image model from the article&apos;s title and search. Blog articles are added to the shop&apos;s own blog only when the merchant chooses to, by pressing a button or by planning them on the content calendar.
        Similarwise sends it only the competitor&apos;s name, website and the country to look at.
      </p>

      <h2>Early-access waitlist</h2>
      <p>
        If you join the waitlist on our website, we keep your email address and your store&apos;s website if you give
        it. We use them only to tell you when Similarwise opens to more stores. We don&apos;t share them. Email us to
        have them deleted.
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
