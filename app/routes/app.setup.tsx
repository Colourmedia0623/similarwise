import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { setupSteps, type Step, type StepKey } from "../lib/setup.server";
import { addCompetitor } from "../lib/tracker/check.server";
import { isWebShop, cleanWebsite, PLATFORMS } from "../lib/web/shop";

// Setup: one step at a time through every account SimilarWise can connect,
// from social networks and Canva to Google and ad accounts, with what each
// one is for, what's needed before signing in, and whether it's connected.
// Signing in opens in a new tab; coming back picks the new connection up.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const web = isWebShop(shop);
  const [steps, workspace] = await Promise.all([
    setupSteps(shop),
    web ? db.workspace.findUnique({ where: { shop }, select: { website: true, platform: true } }) : null,
  ]);
  return { steps, web, website: workspace?.website ?? "", platform: workspace?.platform ?? "", start: new URL(request.url).searchParams.get("step") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "website" && isWebShop(shop)) {
    const raw = String(form.get("website") ?? "");
    const website = cleanWebsite(raw);
    const platform = String(form.get("platform") ?? "");
    if (!website) return { error: "That website doesn't look right. Enter it like yourstore.com." };
    if (!PLATFORMS.some((p) => p.value === platform)) return { error: "Choose what your website runs on." };
    await db.workspace.update({ where: { shop }, data: { website, platform } });
    return { ok: true as const };
  }
  if (intent === "competitor") {
    const result = await addCompetitor(shop, String(form.get("url") ?? ""));
    return "error" in result ? { error: result.error } : { ok: true as const };
  }
  return { ok: true as const };
};

type Guide = { title: string; short: string; badge: string; color: string; why: string; need: string[]; manage?: { label: string; href: string } };

const GUIDE: Record<StepKey, Guide> = {
  website: {
    title: "Your website",
    short: "Website",
    badge: "W",
    color: "linear-gradient(135deg,#6d5dfc,#22c1ee)",
    why: "SimilarWise compares your website with your competitors': prices, products, keywords, traffic and the technology it runs on.",
    need: ["Your website's address, such as yourstore.com", "Shopify and WooCommerce stores also get their products read for price comparison"],
  },
  meta: {
    title: "Facebook and Instagram",
    short: "Facebook and Instagram",
    badge: "f",
    color: "linear-gradient(135deg,#1877f2,#e1306c)",
    why: "Share posts and blog articles to your Facebook Page and Instagram, and answer comments and messages from the social inbox.",
    need: [
      "A Facebook Page you manage (not a personal profile)",
      "For Instagram: a business or creator account, linked to that Page in Instagram's settings",
      "When Facebook asks, tick your Page and your Instagram account, and leave every permission switched on",
    ],
    manage: { label: "Manage social accounts", href: "/app/social" },
  },
  tiktok: {
    title: "TikTok",
    short: "TikTok",
    badge: "♪",
    color: "linear-gradient(135deg,#111,#25f4ee 60%,#fe2c55)",
    why: "Post your videos and pictures to TikTok from the social calendar.",
    need: ["A TikTok account (a business account works best)", "Sign in with the account you post from, then press Authorize"],
    manage: { label: "Manage social accounts", href: "/app/social" },
  },
  pinterest: {
    title: "Pinterest",
    short: "Pinterest",
    badge: "P",
    color: "linear-gradient(135deg,#e60023,#ff6b81)",
    why: "Pin your products and blog articles to your boards, each with a link back to your site.",
    need: ["A Pinterest business account", "At least one board to pin to: make one on Pinterest first if you have none"],
    manage: { label: "Manage social accounts", href: "/app/social" },
  },
  linkedin: {
    title: "LinkedIn",
    short: "LinkedIn",
    badge: "in",
    color: "linear-gradient(135deg,#0a66c2,#4fa3ff)",
    why: "Share your articles and news to your LinkedIn profile.",
    need: ["Your LinkedIn login", "Press Allow when LinkedIn asks to let SimilarWise post for you"],
    manage: { label: "Manage social accounts", href: "/app/social" },
  },
  canva: {
    title: "Canva",
    short: "Canva",
    badge: "C",
    color: "linear-gradient(135deg,#00c4cc,#7d2ae8)",
    why: "Design your post pictures in Canva and bring them straight into a post, without downloading and uploading.",
    need: ["A Canva account (free or Pro)", "Press Allow when Canva asks"],
    manage: { label: "Open the social calendar", href: "/app/publishing" },
  },
  google: {
    title: "Google Analytics and Ads",
    short: "Google Analytics and Ads",
    badge: "G",
    color: "linear-gradient(135deg,#4285f4,#34a853 50%,#fbbc05)",
    why: "See your own visitors, sales and Google Ads spend beside what your competitors are estimated to get and spend.",
    need: [
      "A Google account with access to your Analytics property, your Google Ads account, or both",
      "Tick every box when Google asks what SimilarWise can see",
      "After signing in, choose which property and Ads account to show",
    ],
    manage: { label: "Open Google Analytics and Ads", href: "/app/google" },
  },
  ads: {
    title: "Ad accounts",
    short: "Ad accounts",
    badge: "Ads",
    color: "linear-gradient(135deg,#f59e0b,#ef4444)",
    why: "Watch what your Facebook, Instagram and TikTok campaigns cost and bring in, change budgets, switch them on and off, and set a monthly spend limit.",
    need: [
      "For Meta: admin or advertiser access to the ad account in Meta Business",
      "For TikTok: access to your advertiser account in TikTok Ads Manager",
    ],
    manage: { label: "Open paid social ads", href: "/app/paid-social" },
  },
  competitors: {
    title: "Your competitors",
    short: "Competitors",
    badge: "★",
    color: "linear-gradient(135deg,#6d5dfc,#ec4899)",
    why: "Add the sites you compete with. SimilarWise checks their prices, products, ads, keywords and traffic for you every day.",
    need: ["Their website addresses, such as rival.com", "Start with two or three; you can add more any time"],
    manage: { label: "Open competitors", href: "/app/competitors" },
  },
};

export default function Setup() {
  const { steps, web, website, platform, start } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const firstOpen = steps.find((s) => !s.done && !s.soon)?.key ?? steps[0].key;
  const [current, setCurrent] = useState<StepKey>(steps.some((s) => s.key === start) ? (start as StepKey) : firstOpen);

  // Signing in happens in another tab; pick up new connections on coming back.
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && revalidator.revalidate();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [revalidator]);

  const counted = steps.filter((s) => !s.soon);
  const done = counted.filter((s) => s.done).length;
  const pct = counted.length ? Math.round((done / counted.length) * 100) : 0;
  const index = steps.findIndex((s) => s.key === current);
  const step = steps[index];
  const go = (i: number) => setCurrent(steps[Math.max(0, Math.min(steps.length - 1, i))].key);

  return (
    <s-page heading="Setup">
      <style>{CSS}</style>
      <div className="sw-setup">
        <div className="sw-setup-hero">
          <div>
            <h1>{done === counted.length ? "You're all set up" : "Connect your channels"}</h1>
            <p>
              A few minutes, one step at a time. Each sign-in opens in a new tab, and this page notices as soon as you come back. Skip anything you don&rsquo;t use; you can come back
              here any time.
            </p>
          </div>
          <div className="sw-setup-meter" aria-label={`${done} of ${counted.length} done`}>
            <div className="sw-setup-ring" style={{ background: `conic-gradient(#fff ${pct * 3.6}deg, rgba(255,255,255,.22) 0)` }}>
              <span>{pct}%</span>
            </div>
            <small>
              {done} of {counted.length} done
            </small>
          </div>
        </div>

        <div className="sw-setup-body">
          <ol className="sw-setup-steps">
            {steps.map((s, i) => {
              const g = GUIDE[s.key];
              return (
                <li key={s.key}>
                  <button type="button" className={s.key === current ? "on" : ""} onClick={() => setCurrent(s.key)}>
                    <span className={`sw-setup-dot${s.done ? " done" : ""}`}>{s.done ? "✓" : i + 1}</span>
                    <span className="sw-setup-label">{g.short}</span>
                    {s.soon && !s.done ? <em>Soon</em> : null}
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="sw-setup-card" key={step.key}>
            <StepCard step={step} web={web} website={website} platform={platform} />
            <div className="sw-setup-nav">
              <button type="button" className="ghost" disabled={index === 0} onClick={() => go(index - 1)}>
                ← Back
              </button>
              <span>
                Step {index + 1} of {steps.length}
              </span>
              {index < steps.length - 1 ? (
                <button type="button" className={step.done ? "primary" : "ghost"} onClick={() => go(index + 1)}>
                  {step.done ? "Next →" : "Skip for now →"}
                </button>
              ) : (
                <s-button variant={done === counted.length ? "primary" : "secondary"} href="/app">
                  Go to the overview
                </s-button>
              )}
            </div>
          </div>
        </div>
      </div>
    </s-page>
  );
}

function StepCard({ step, web, website, platform }: { step: Step; web: boolean; website: string; platform: string }) {
  const g = GUIDE[step.key];
  return (
    <>
      <div className="sw-setup-head">
        <span className="sw-setup-badge" style={{ background: g.color }}>
          {g.badge}
        </span>
        <div>
          <h2>{g.title}</h2>
          <span className={`sw-setup-status ${step.done ? "yes" : step.soon ? "soon" : "no"}`}>{step.done ? "Connected" : step.soon ? "Coming soon" : "Not connected yet"}</span>
        </div>
      </div>
      <p className="sw-setup-why">{g.why}</p>

      {step.connected.length ? (
        <div className="sw-setup-chips">
          {step.connected.map((c) => (
            <span key={c}>✓ {c}</span>
          ))}
        </div>
      ) : null}

      {step.key === "website" ? (
        web ? (
          <WebsiteForm website={website} platform={platform} />
        ) : (
          <p className="sw-setup-note">Your Shopify store is connected already. SimilarWise reads your products straight from Shopify.</p>
        )
      ) : step.key === "competitors" ? (
        <CompetitorForm />
      ) : step.soon ? (
        <p className="sw-setup-note">This connection is waiting for approval from the network. We&rsquo;ll switch it on here as soon as it&rsquo;s ready; nothing for you to do.</p>
      ) : (
        <>
          <div className="sw-setup-need">
            <strong>{step.done ? "To add another account" : "Before you start"}</strong>
            <ul>
              {g.need.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <div className="sw-setup-actions">
            {step.links.map((l) => (
              <s-button key={l.href} variant={step.done ? "secondary" : "primary"} href={l.href} target="_blank">
                {step.done && l.label.startsWith("Connect") ? l.label.replace("Connect", "Add another:") : l.label}
              </s-button>
            ))}
          </div>
        </>
      )}

      {step.todo ? (
        <p className="sw-setup-todo">
          {step.todo.text}{" "}
          <s-link href={step.todo.href}>Do it now</s-link>
        </p>
      ) : null}

      {g.manage && step.key !== "competitors" ? (
        <p className="sw-setup-manage">
          <s-link href={g.manage.href}>{g.manage.label}</s-link>
        </p>
      ) : null}
    </>
  );
}

function WebsiteForm({ website, platform }: { website: string; platform: string }) {
  const f = useFetcher<typeof action>();
  const [site, setSite] = useState(website);
  const [plat, setPlat] = useState(platform || "shopify");
  const saving = f.state !== "idle";
  const result = f.data;
  return (
    <f.Form method="post" className="sw-setup-form">
      <input type="hidden" name="intent" value="website" />
      <label>
        Website
        <input name="website" value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourstore.com" />
      </label>
      <label>
        Runs on
        <select name="platform" value={plat} onChange={(e) => setPlat(e.target.value)}>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="primary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      {result && "error" in result ? <p className="sw-setup-error">{result.error}</p> : null}
      {result && "ok" in result && !saving ? <p className="sw-setup-ok">Saved.</p> : null}
    </f.Form>
  );
}

function CompetitorForm() {
  const f = useFetcher<typeof action>();
  const form = useRef<HTMLFormElement>(null);
  const adding = f.state !== "idle";
  const result = f.data;
  useEffect(() => {
    if (f.state === "idle" && result && "ok" in result) form.current?.reset();
  }, [f.state, result]);
  return (
    <f.Form method="post" className="sw-setup-form" ref={form}>
      <input type="hidden" name="intent" value="competitor" />
      <label className="grow">
        Competitor&rsquo;s website
        <input name="url" required placeholder="rival.com" />
      </label>
      <button type="submit" className="primary" disabled={adding}>
        {adding ? "Adding… (takes a minute)" : "Add competitor"}
      </button>
      {result && "error" in result ? <p className="sw-setup-error">{result.error}</p> : null}
    </f.Form>
  );
}

const CSS = `
.sw-setup{--grad:var(--sw-grad,linear-gradient(135deg,var(--sw-accent,#6d5dfc) 0%,#2f7bff 55%,#22c1ee 100%));font-family:inherit;color:#0b1020}
.sw-setup-hero{display:flex;gap:24px;align-items:center;justify-content:space-between;padding:26px 28px;border-radius:20px;color:var(--sw-ink,#fff);background:radial-gradient(500px 220px at 90% 0%,color-mix(in srgb,var(--sw-accent-2,#22c1ee) 45%,transparent),transparent 70%),var(--grad);box-shadow:0 18px 40px -18px color-mix(in srgb,var(--sw-accent-2,#4c40e6) 60%,transparent);margin-bottom:18px}
.sw-setup-hero h1{margin:0 0 6px;font-size:26px;letter-spacing:-.02em}
.sw-setup-hero p{margin:0;max-width:620px;opacity:.92;line-height:1.5}
.sw-setup-meter{display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0}
.sw-setup-ring{width:86px;height:86px;border-radius:50%;display:grid;place-items:center;transition:background .4s}
.sw-setup-ring span{width:66px;height:66px;border-radius:50%;display:grid;place-items:center;background:var(--sw-accent-2,#4b46e6);font-weight:750;font-size:18px}
.sw-setup-meter small{opacity:.9}
.sw-setup-body{display:grid;grid-template-columns:260px 1fr;gap:18px;align-items:start}
.sw-setup-steps{list-style:none;margin:0;padding:8px;background:#fff;border:1px solid #e7e9f2;border-radius:16px;position:sticky;top:76px}
.sw-setup-steps button{all:unset;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;font-size:14px}
.sw-setup-steps button:hover{background:#f3f4fb}
.sw-setup-steps button.on{background:linear-gradient(90deg,color-mix(in srgb,var(--sw-accent,#6d5dfc) 14%,transparent),color-mix(in srgb,var(--sw-accent-2,#2f7bff) 6%,transparent));font-weight:650}
.sw-setup-steps em{margin-left:auto;font-style:normal;font-size:11px;color:#8a91a5;background:#f1f2f7;border-radius:999px;padding:2px 8px}
.sw-setup-label{flex:1;min-width:0}
.sw-setup-dot{width:24px;height:24px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;border:1.5px solid #d6d9e6;color:#5b6478;background:#fff}
.sw-setup-steps button.on .sw-setup-dot{border-color:var(--sw-text,#6d5dfc);color:var(--sw-text,#6d5dfc)}
.sw-setup-dot.done,.sw-setup-steps button.on .sw-setup-dot.done{border:0;color:#fff;background:linear-gradient(135deg,#22c55e,#10b981)}
.sw-setup-card{background:#fff;border:1px solid #e7e9f2;border-radius:20px;padding:26px 28px 18px;box-shadow:0 10px 30px -20px rgba(15,20,40,.25);animation:swIn .25s ease}
@keyframes swIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.sw-setup-head{display:flex;gap:14px;align-items:center}
.sw-setup-head h2{margin:0 0 4px;font-size:21px;letter-spacing:-.01em}
.sw-setup-badge{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:20px;flex-shrink:0;box-shadow:0 8px 20px -8px rgba(15,20,40,.45)}
.sw-setup-status{font-size:12px;font-weight:650;border-radius:999px;padding:3px 10px}
.sw-setup-status.yes{background:#dcfce7;color:#15803d}
.sw-setup-status.no{background:color-mix(in srgb,var(--sw-accent,#6d5dfc) 12%,#fff);color:var(--sw-text,#4b46e6)}
.sw-setup-status.soon{background:#f1f2f7;color:#5b6478}
.sw-setup-why{font-size:15px;line-height:1.55;color:#323a4f;margin:16px 0}
.sw-setup-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.sw-setup-chips span{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:999px;padding:4px 12px;font-size:13px}
.sw-setup-need{background:#f7f8fc;border:1px solid #eceef6;border-radius:14px;padding:14px 18px;margin-bottom:16px}
.sw-setup-need strong{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#5b6478}
.sw-setup-need ul{margin:8px 0 0;padding-left:20px;line-height:1.6}
.sw-setup-actions{display:flex;flex-wrap:wrap;gap:10px}
.sw-setup-note{background:#f7f8fc;border-radius:12px;padding:12px 16px;color:#5b6478;line-height:1.5}
.sw-setup-todo{background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 14px;color:#9a3412}
.sw-setup-manage{margin:14px 0 0;font-size:14px}
.sw-setup-form{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.sw-setup-form label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;color:#323a4f}
.sw-setup-form label.grow{flex:1;min-width:220px}
.sw-setup-form input,.sw-setup-form select{font:inherit;font-weight:400;font-size:14px;padding:9px 12px;border:1px solid #d6d9e6;border-radius:10px;background:#fff;min-width:200px;outline:none}
.sw-setup-form input:focus,.sw-setup-form select:focus{border-color:var(--sw-accent,#6d5dfc);box-shadow:0 0 0 3px color-mix(in srgb,var(--sw-accent,#6d5dfc) 18%,transparent)}
.sw-setup-error{flex-basis:100%;margin:0;color:#b91c1c}
.sw-setup-ok{flex-basis:100%;margin:0;color:#15803d}
.sw-setup button.primary,.sw-setup button.ghost{font:inherit;font-size:14px;font-weight:600;border-radius:10px;padding:9px 16px;cursor:pointer;border:1px solid transparent}
.sw-setup button.primary{color:var(--sw-ink,#fff);background:var(--grad);box-shadow:0 6px 16px -6px color-mix(in srgb,var(--sw-accent-2,#4c40e6) 60%,transparent)}
.sw-setup button.primary:hover{filter:brightness(1.07)}
.sw-setup button.ghost{background:#fff;border-color:#d6d9e6;color:#323a4f}
.sw-setup button.ghost:hover{background:#f6f7fb}
.sw-setup button:disabled{opacity:.5;cursor:default}
.sw-setup-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:24px;padding-top:16px;border-top:1px solid #eef0f6}
.sw-setup-nav span{font-size:13px;color:#8a91a5}
@media (max-width:820px){
  .sw-setup-hero{flex-direction:column;align-items:flex-start;padding:22px}
  .sw-setup-body{grid-template-columns:1fr}
  .sw-setup-steps{position:static;display:flex;overflow-x:auto;gap:4px}
  .sw-setup-steps button{width:auto;white-space:nowrap}
  .sw-setup-steps em{display:none}
  .sw-setup-card{padding:20px}
}
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
