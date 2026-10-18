import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { login } from "../../shopify.server";
import { parseSignup } from "../../lib/waitlist";
import { saveSignup } from "../../lib/waitlist.server";

import styles from "./styles.module.css";

// The public landing page: everything Similarwise does, grouped the way the
// app's menu is, and the early-access waitlist.

export const meta: MetaFunction = () => [
  { title: "Similarwise: competitor intelligence and growth for Shopify stores" },
  {
    name: "description",
    content: "Track competitors' products, prices, ads and traffic, win their Google searches with ready-written blog posts, and share them to social, all inside your Shopify admin.",
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
  const parsed = parseSignup(form);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  await saveSignup(parsed.signup);
  return { ok: true as const };
};

// Each group matches a part of the app's menu, so the page shows all of it.
const GROUPS = [
  {
    id: "watch",
    tag: "Watch",
    title: "See every move your competitors make",
    intro: "Add the stores you compete with. Similarwise checks them every day and tells you what changed.",
    features: [
      { title: "Competitor tracker", body: "New launches, price cuts and products taken down, with each store's full catalogue over time." },
      { title: "Price comparison", body: "Your products matched to the same products at each competitor, showing who's cheaper and by how much." },
      { title: "Traffic and engagement", body: "Monthly visits for every store, and how visitors behave once they arrive." },
      { title: "Marketing channels", body: "Where each store's visits come from: Google, paid search, social, email and more." },
      { title: "Website technologies", body: "The theme, apps and tracking pixels each store runs, next to your own." },
      { title: "Similar sites", body: "Stores competing for the same Google searches as you, one click from being tracked." },
    ],
  },
  {
    id: "ads",
    tag: "Advertise",
    title: "Know what's working in their ads",
    intro: "Read competitors' live ads from the public Meta, TikTok and Google ad libraries, then turn them into ads of your own.",
    features: [
      { title: "Competitors' ads", body: "Every ad they run on Meta, TikTok and Google, and their estimated Google Ads spend." },
      { title: "Ad ideas", body: "The angles their ads keep repeating, and ready-written ads for your own products." },
    ],
  },
  {
    id: "search",
    tag: "Grow",
    title: "Win the searches they win",
    intro: "Find the Google searches sending visitors to your competitors and not to you, then fill the gap.",
    features: [
      { title: "Keyword gap", body: "Searches that bring competitors visits where you don't rank, or rank below them." },
      { title: "Keyword ideas", body: "Which page to point at each search, and the words to put on it." },
      { title: "AI mentions", body: "Whether ChatGPT, Gemini and Perplexity recommend you or your competitors, and the sites they quote." },
      { title: "Link gap", body: "Websites that link to competitors but not to you, with an outreach email written for each." },
    ],
  },
  {
    id: "content",
    tag: "Publish",
    title: "Blog posts that write themselves",
    intro: "Turn the keyword gap into articles on your own Shopify blog, then share them everywhere your customers are.",
    features: [
      { title: "Blog articles", body: "Full articles written for the searches you're missing, each with its own picture, added to your blog in one click." },
      { title: "Content calendar", body: "Plan a post a day. Each one is written and published on its day." },
      { title: "Social sharing", body: "Post every article to your Facebook Page, Instagram and TikTok, with a caption written for each." },
    ],
  },
  {
    id: "alerts",
    tag: "Stay ahead",
    title: "Hear about it first",
    intro: "You don't need to check in every day. Similarwise brings the news to your inbox.",
    features: [
      { title: "Email alerts", body: "An email when a competitor changes prices, launches products, starts new ads or sees a big swing in search traffic." },
      { title: "Weekly summary", body: "Everything that changed across your competitors, in one short email every Monday." },
    ],
  },
];

const STEPS = [
  { title: "Install from Shopify", body: "Similarwise opens inside your Shopify admin. There's no new login and nothing to set up on your theme." },
  { title: "Add your competitors", body: "Paste their websites, or pick from the similar sites Similarwise finds for you." },
  { title: "Act on what you see", body: "Match their prices, publish the articles you're missing, and run ads built from what works for them." },
];

const REPLACES = ["Competitor price tracking", "Traffic estimates", "Ad library research", "SEO keyword tools", "Blog writing", "Social scheduling"];

const FAQ = [
  {
    q: "Is it only for Shopify stores?",
    a: "Your store needs to be on Shopify, because Similarwise lives in your Shopify admin. Your competitors can be on any platform, though product and price tracking works best on Shopify stores.",
  },
  {
    q: "Where does the data come from?",
    a: "From competitors' public storefronts, the public Meta, TikTok and Google ad libraries, and trusted search and traffic data providers. Nothing private is ever accessed.",
  },
  {
    q: "Do I have to publish the articles it writes?",
    a: "No. Every article waits for you to read and edit it. It only goes on your blog, or out to social, when you say so.",
  },
  {
    q: "Can competitors see that I'm tracking them?",
    a: "No. Similarwise only reads pages anyone can visit, the same as a shopper would.",
  },
];

// A sketch of the app's overview page, with made-up example numbers.
function Preview() {
  return (
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewBar}>
        <span />
        <span />
        <span />
        <p>Similarwise · Overview</p>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.tiles}>
          <div>
            <p>Price changes this week</p>
            <strong>38</strong>
            <em className={styles.down}>12 cuts</em>
          </div>
          <div>
            <p>New competitor products</p>
            <strong>14</strong>
            <em>across 5 stores</em>
          </div>
          <div>
            <p>Searches you&apos;re missing</p>
            <strong>1,240</strong>
            <em className={styles.up}>9.8k visits a month</em>
          </div>
          <div>
            <p>Competitor ads running</p>
            <strong>67</strong>
            <em>Meta, TikTok, Google</em>
          </div>
        </div>
        <ul className={styles.feed}>
          <li>
            <b>northbox.co</b> cut the price of <i>Luxury Hamper</i> from £45 to £39
          </li>
          <li>
            <b>giftly.com</b> launched 6 new products
          </li>
          <li>
            <b>Your article</b> &ldquo;Best gift boxes for him&rdquo; went live and was shared to Instagram
          </li>
        </ul>
      </div>
    </div>
  );
}

function Waitlist() {
  const result = useActionData<typeof action>();
  const sending = useNavigation().state === "submitting";
  if (result?.ok)
    return <p className={styles.thanks}>Thanks, you&apos;re on the list. We&apos;ll email you when Similarwise opens to more stores.</p>;
  return (
    <Form method="post" className={styles.form}>
      <label className={styles.field}>
        <span>Email</span>
        <input type="email" name="email" required autoComplete="email" placeholder="you@yourstore.com" />
      </label>
      <label className={styles.field}>
        <span>Your store&apos;s website (optional)</span>
        <input type="text" name="store" placeholder="yourstore.com" />
      </label>
      <label className={styles.hidden} aria-hidden="true">
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {result && !result.ok && <p className={styles.error}>{result.error}</p>}
      <button className={styles.cta} type="submit" disabled={sending}>
        {sending ? "Sending…" : "Join the waitlist"}
      </button>
    </Form>
  );
}

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <p className={styles.brand}>Similarwise</p>
        <div>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#faq">FAQ</a>
          <a className={styles.navCta} href="#early-access">
            Get early access
          </a>
        </div>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>Competitor intelligence and growth for Shopify</p>
        <h1 className={styles.heading}>Outsmart your competitors without leaving Shopify</h1>
        <p className={styles.lead}>
          Track their products, prices, traffic and ads every day. Then win the Google searches they win, with blog
          posts written for you and shared to Facebook, Instagram and TikTok.
        </p>
        <div className={styles.ctas}>
          <a className={styles.cta} href="#early-access">
            Get early access
          </a>
          <a className={styles.ghost} href="#features">
            See everything it does
          </a>
        </div>
        <ul className={styles.badges}>
          <li>Lives in your Shopify admin</li>
          <li>Checked every day</li>
          <li>A fraction of the price of SimilarWeb</li>
        </ul>
        <Preview />
      </header>

      <section className={styles.replaces}>
        <h2>One app instead of six tools</h2>
        <ul>
          {REPLACES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <div id="features">
        {GROUPS.map((g, i) => (
          <section key={g.id} id={g.id} className={`${styles.group} ${i % 2 ? styles.alt : ""}`}>
            <p className={styles.tag}>{g.tag}</p>
            <h2>{g.title}</h2>
            <p className={styles.intro}>{g.intro}</p>
            <ul className={styles.cards}>
              {g.features.map((f) => (
                <li key={f.title}>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section id="how" className={styles.how}>
        <h2>Up and running in minutes</h2>
        <ol>
          {STEPS.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="faq" className={styles.faq}>
        <h2>Questions</h2>
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section id="early-access" className={styles.waitlist}>
        <h2>Be one of the first stores on Similarwise</h2>
        <p>We&apos;re opening to more stores soon. Join the waitlist and we&apos;ll email you as soon as there&apos;s a place.</p>
        <Waitlist />
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
          Made by Colourmedia. <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a> · <a href="/data-deletion">Deleting your data</a>
        </p>
      </footer>
    </div>
  );
}
