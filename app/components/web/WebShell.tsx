import { Children, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Form, NavLink, useFetcher, useLocation, useNavigate } from "react-router";
import { THEMES, themeFor, themeStyle } from "../../lib/web/themes";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import styles from "./shell.module.css";

// The full-screen frame for the standalone web version: a sidebar menu, the
// workspace and account bar, and the same app pages inside. It takes the same
// children as Shopify's AppProvider in routes/app.tsx, so the <s-app-nav>
// there stays the one menu for both: its links become this sidebar.

const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris.js";

export type WebShellAccount = {
  user: { email: string; name: string | null; theme?: string | null };
  workspace: { id: string; name: string; website: string | null };
  workspaces: { id: string; name: string }[];
  trialDays: number | null;
  admin?: boolean;
  notices?: { items: Notice[]; unread: number };
};

type Notice = { id: string; kind: "competitor" | "inbox" | "mention"; title: string; text: string; at: string; href: string; unread: boolean };

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return m <= 1 ? "Just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const NOTICE_ICON: Record<Notice["kind"], string> = { competitor: "M3 3v18h18M7 15l4-4 3 3 5-6", inbox: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", mention: "M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6" };

// The bell: what's new since it was last opened. Opening it marks all seen.
function Bell({ notices }: { notices: { items: Notice[]; unread: number } }) {
  // Open until the next page, like the menu on small screens.
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (on: boolean) => setOpenOn(on ? pathname : null);
  const seen = useFetcher();
  const unread = seen.formData ? 0 : notices.unread;
  // Kept as they were when opened, so what was new stays marked while it's open.
  const [shown, setShown] = useState(notices.items);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(`.${styles.bell}`)) setOpenOn(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className={styles.bell}>
      <button
        className={styles.topIcon}
        type="button"
        title="Notifications"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) setShown(notices.items);
          if (!open && notices.unread && !seen.formData) seen.submit({}, { method: "post", action: "/notifications" });
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className={styles.notices} role="dialog" aria-label="Notifications">
          <header>
            <strong>Notifications</strong>
            <NavLink to="/app/settings">Email alerts</NavLink>
          </header>
          {shown.length ? (
            <ul>
              {shown.map((n) => (
                <li key={n.id} className={n.unread ? styles.noticeNew : undefined}>
                  <NavLink to={n.href}>
                    <span className={`${styles.noticeIcon} ${styles[`notice_${n.kind}`] ?? ""}`} aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={NOTICE_ICON[n.kind]} />
                      </svg>
                    </span>
                    <span className={styles.noticeBody}>
                      <strong>{n.title}</strong>
                      <span>{n.text}</span>
                      <time dateTime={n.at}>{ago(n.at)}</time>
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.noticesEmpty}>Nothing new. Price changes, products selling out and new messages show up here.</p>
          )}
        </div>
      )}
    </div>
  );
}

// Sidebar sections, by page. Pages not listed go under More.
const GROUPS: [string, string[]][] = [
  ["", ["/app", "/app/setup"]],
  ["Competitors", ["/app/competitors", "/app/similar", "/app/prices", "/app/stock", "/app/tech", "/app/traffic", "/app/channels"]],
  ["Search and content", ["/app/keywords", "/app/ranks", "/app/audit", "/app/ai", "/app/ideas", "/app/articles", "/app/calendar", "/app/links", "/app/outreach"]],
  ["Social", ["/app/listening", "/app/publishing", "/app/inbox", "/app/social", "/app/paid-social"]],
  ["Ads and analytics", ["/app/ads", "/app/ad-ideas", "/app/google", "/app/reports"]],
  ["Account", ["/app/settings", "/app/plans", "/app/help", "/app/waitlist", "/app/admin", "/app/admin/plans"]],
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

// Where a page sits: its sidebar section, its menu link, and for a page
// inside that one (a competitor, an article), the page's own heading.
function crumbsFor(pathname: string, links: Link[]) {
  const link = links
    .filter((l) => pathname === l.href || (l.href !== "/app" && pathname.startsWith(`${l.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!link) return null;
  const group = GROUPS.find(([, hrefs]) => hrefs.includes(link.href))?.[0] ?? (link.href === "/app" ? "" : "More");
  return { group, link, inside: pathname !== link.href };
}

// The heading of the page showing now, kept up to date as it changes.
function usePageHeading(pathname: string) {
  const [heading, setHeading] = useState("");
  useEffect(() => {
    const read = () => setHeading(document.querySelector("main s-page")?.getAttribute("heading") ?? "");
    read();
    const main = document.querySelector("main");
    if (!main) return;
    const watch = new MutationObserver(read);
    watch.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["heading"] });
    return () => watch.disconnect();
  }, [pathname]);
  return heading;
}

// The <script> below only runs when the page is loaded whole. Arriving from
// the login or welcome page is a move within the same page, and React never
// runs a script it adds itself, so Polaris is loaded here instead.
function usePolaris() {
  useEffect(() => {
    if (customElements.get("s-page") || document.querySelector("script[data-sw-polaris]")) return;
    const el = document.createElement("script");
    el.src = POLARIS_URL;
    el.dataset.swPolaris = "";
    document.head.appendChild(el);
  }, []);
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
  const links = navLinks(nav);
  const groups = grouped(links);
  // The menu on small screens, open until the next page.
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  useInPlaceLinks();
  usePolaris();
  // The colour shows as soon as it's picked, before it's saved.
  const paint = useFetcher();
  const theme = String(paint.formData?.get("theme") ?? account.user.theme ?? "");
  const [palette, setPalette] = useState(false);
  const crumbs = crumbsFor(pathname, links);
  const heading = usePageHeading(pathname);

  const initials = (account.user.name ?? account.user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <div className={styles.shell} style={themeStyle(theme)}>
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
                <NavLink key={l.href} to={l.href} end={l.href === "/app" || l.href === "/app/admin"} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}>
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
          <div className={styles.paint}>
            <button className={styles.paintButton} type="button" title="Colours" aria-label="Choose colours" aria-expanded={palette} onClick={() => setPalette(!palette)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2.5a1.5 1.5 0 0 0-1 2.6A1.5 1.5 0 0 1 12 22Z" />
                <circle cx="7.5" cy="10.5" r="1" />
                <circle cx="12" cy="7" r="1" />
                <circle cx="16.5" cy="10.5" r="1" />
              </svg>
            </button>
            {palette && (
              <div className={styles.palette} role="dialog" aria-label="Colours">
                <p>Dashboard colour</p>
                <div className={styles.swatches}>
                  {THEMES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      title={t.name}
                      aria-label={t.name}
                      aria-pressed={themeFor(theme).key === t.key}
                      className={`${styles.swatch} ${themeFor(theme).key === t.key ? styles.swatchOn : ""}`}
                      style={{ background: t.grad ?? `linear-gradient(135deg, ${t.light}, ${t.dark})` }}
                      onClick={() => paint.submit({ theme: t.key }, { method: "post", action: "/theme" })}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
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
          <nav className={styles.crumbs} aria-label="Breadcrumb">
            <ol>
              <li>
                <NavLink to="/app" className={styles.wsName} end>
                  {account.workspace.name}
                </NavLink>
              </li>
              {crumbs?.group && crumbs.group !== crumbs.link.label && <li className={styles.crumbGroup}>{crumbs.group}</li>}
              {crumbs && (
                <li>
                  {crumbs.inside ? (
                    <NavLink to={crumbs.link.href} end>
                      {crumbs.link.label}
                    </NavLink>
                  ) : (
                    <span aria-current="page">{crumbs.link.label}</span>
                  )}
                </li>
              )}
              {crumbs?.inside && heading && heading !== crumbs.link.label && (
                <li>
                  <span aria-current="page">{heading}</span>
                </li>
              )}
            </ol>
          </nav>
          <div className={styles.spacer} />
          {account.workspace.website && <span className={styles.site}>{account.workspace.website}</span>}
          <NavLink to="/app/help" className={({ isActive }) => `${styles.topIcon} ${isActive ? styles.topIconOn : ""}`} title="Help" aria-label="Help">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
            </svg>
          </NavLink>
          {account.notices && <Bell notices={account.notices} />}
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
