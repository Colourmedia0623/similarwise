import { Children, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Form, NavLink, useLocation, useNavigate } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import styles from "./shell.module.css";

// The full-screen frame for the standalone web version: a sidebar menu, the
// workspace and account bar, and the same app pages inside. It takes the same
// children as Shopify's AppProvider in routes/app.tsx, so the <s-app-nav>
// there stays the one menu for both: its links become this sidebar.

const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris.js";

export type WebShellAccount = {
  user: { email: string; name: string | null };
  workspace: { id: string; name: string; website: string | null };
  workspaces: { id: string; name: string }[];
  trialDays: number | null;
  admin?: boolean;
};

// Sidebar sections, by page. Pages not listed go under More.
const GROUPS: [string, string[]][] = [
  ["", ["/app"]],
  ["Competitors", ["/app/competitors", "/app/similar", "/app/prices", "/app/stock", "/app/tech", "/app/traffic", "/app/channels"]],
  ["Search and content", ["/app/keywords", "/app/ranks", "/app/audit", "/app/ai", "/app/ideas", "/app/articles", "/app/calendar", "/app/links", "/app/outreach"]],
  ["Social", ["/app/listening", "/app/publishing", "/app/inbox", "/app/social", "/app/paid-social"]],
  ["Ads and analytics", ["/app/ads", "/app/ad-ideas", "/app/google", "/app/reports"]],
  ["Account", ["/app/settings", "/app/plans", "/app/help", "/app/waitlist", "/app/admin"]],
];

type Link = { href: string; label: string };

function navLinks(nav: ReactElement | undefined): Link[] {
  if (!nav) return [];
  const out: Link[] = [];
  Children.forEach((nav.props as { children?: ReactNode }).children, (c) => {
    if (!isValidElement(c)) return;
    const p = c.props as { href?: string; children?: ReactNode };
    if (p.href) out.push({ href: p.href, label: Children.toArray(p.children).join("") });
  });
  return out;
}

function grouped(links: Link[]) {
  const used = new Set<string>();
  const groups = GROUPS.map(([title, hrefs]) => {
    const items = hrefs.flatMap((h) => links.filter((l) => l.href === h));
    items.forEach((l) => used.add(l.href));
    return { title, items };
  });
  groups.splice(groups.length - 1, 0, { title: "More", items: links.filter((l) => !used.has(l.href)) });
  return groups.filter((g) => g.items.length);
}

// Polaris links and buttons with an href would load the whole page again;
// this opens app pages in place instead, the way App Bridge does in Shopify.
function useInPlaceLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      for (const el of e.composedPath()) {
        if (!(el instanceof HTMLElement)) continue;
        const tag = el.tagName.toLowerCase();
        if (tag !== "s-link" && tag !== "s-button" && tag !== "s-clickable") continue;
        const href = el.getAttribute("href");
        if (!href || !href.startsWith("/") || href.startsWith("//") || el.hasAttribute("target")) return;
        e.preventDefault();
        navigate(href);
        return;
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);
}

export function WebShell({ account, children }: { account: WebShellAccount; children: ReactNode }) {
  const kids = Children.toArray(children);
  const nav = kids.find((c): c is ReactElement => isValidElement(c) && c.type === "s-app-nav");
  const rest = kids.filter((c) => c !== nav);
  const groups = grouped(navLinks(nav));
  // The menu on small screens, open until the next page.
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  useInPlaceLinks();

  const initials = (account.user.name ?? account.user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <div className={styles.shell}>
      <script src={POLARIS_URL} />
      <aside className={`${styles.side} ${open ? styles.sideOpen : ""}`}>
        <a className={styles.brand} href="/app">
          <img src="/icon-512.png" alt="" />
          <span>SimilarWise</span>
        </a>
        <Form method="post" action="/workspace/switch" className={styles.workspace}>
          <span className={styles.wsBadge} aria-hidden="true">
            {account.workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <select
            name="workspaceId"
            aria-label="Workspace"
            defaultValue={account.workspace.id}
            key={account.workspace.id}
            onChange={(e) => {
              if (e.currentTarget.value === "new") window.location.href = "/welcome?new";
              else e.currentTarget.form?.requestSubmit();
            }}
          >
            {account.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            <option value="new">+ Add a workspace</option>
          </select>
        </Form>
        <nav className={styles.nav} aria-label="SimilarWise">
          {groups.map((g) => (
            <div key={g.title || "home"} className={styles.group}>
              {g.title && <div className={styles.groupTitle}>{g.title}</div>}
              {g.items.map((l) => (
                <NavLink key={l.href} to={l.href} end={l.href === "/app"} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}>
                  {l.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.me}>
          <span className={styles.avatar} aria-hidden="true">
            {initials}
          </span>
          <span className={styles.who}>
            <strong>{account.user.name ?? "Your account"}</strong>
            <span>{account.user.email}</span>
          </span>
          <Form method="post" action="/logout">
            <button className={styles.logout} type="submit" title="Log out" aria-label="Log out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </Form>
        </div>
      </aside>
      {open && <button className={styles.scrim} type="button" aria-label="Close menu" onClick={() => setOpenOn(null)} />}
      <div className={styles.content}>
        <header className={styles.top}>
          <button className={styles.menuButton} type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpenOn(open ? null : pathname)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <span className={styles.wsName}>{account.workspace.name}</span>
          {account.workspace.website && <span className={styles.site}>{account.workspace.website}</span>}
          <div className={styles.spacer} />
          {account.trialDays != null && (
            <a className={styles.trial} href="/app/plans">
              <span className={styles.pulse} aria-hidden="true" />
              {account.trialDays === 0 ? "Trial ends today" : `${account.trialDays} trial day${account.trialDays === 1 ? "" : "s"} left`}
              <strong>Upgrade</strong>
            </a>
          )}
        </header>
        <main className={styles.main}>{rest}</main>
      </div>
    </div>
  );
}

// Shopify's frame inside Shopify admin, or the web version's own.
export function AppShell({ apiKey, web, children }: { apiKey: string; web: WebShellAccount | null; children: ReactNode }) {
  return web ? <WebShell account={web}>{children}</WebShell> : <AppProvider apiKey={apiKey}>{children}</AppProvider>;
}
