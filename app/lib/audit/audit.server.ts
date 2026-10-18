import db from "../../db.server";
import { fetchPublic, type Fetcher } from "../tracker/fetch.server";
import { shopDomain } from "../traffic/gap.server";

// Site audit: reads the shop's own storefront weekly, its home page and a
// sample of products, collections, pages and blog posts from its sitemap,
// and lists the SEO problems found, with how to fix each.

const WEEK = 7 * 86400_000;
const MIN_GAP = 3600_000; // Between checks the merchant starts
const STUCK = 3600_000;
const KEEP_RUNS = 10;
const PER_SITEMAP = 12; // Pages taken from each part of the sitemap
const MAX_PAGES = 50;
const MAX_LINKS = 80; // Other links on the store checked for errors
const SLOW_MS = 3000;
const AT_ONCE = 4;

export type Severity = "error" | "warning" | "notice";

export const CHECKS = {
  broken_page: { severity: "error", label: "Pages that don't load", fix: "These pages answer with an error. Fix or remove links to them, or set up a redirect in Online Store → Navigation → URL redirects." },
  broken_link: { severity: "error", label: "Broken links", fix: "These pages link to addresses on your store that answer with an error. Update or remove the links." },
  noindex: { severity: "error", label: "Hidden from Google", fix: "These pages tell Google not to list them. Remove the noindex tag unless that's what you want." },
  no_title: { severity: "error", label: "Missing page title", fix: "Give each page a title in its Search engine listing section." },
  duplicate_title: { severity: "warning", label: "Same title on several pages", fix: "Google may show only one of them. Give each page its own title." },
  long_title: { severity: "warning", label: "Title too long", fix: "Google cuts titles off after about 60 characters. Put the words that matter first." },
  no_description: { severity: "warning", label: "Missing meta description", fix: "Write a sentence or two for each page's Search engine listing, so Google shows your words." },
  duplicate_description: { severity: "warning", label: "Same description on several pages", fix: "Write a description for each page, so each one stands out in Google." },
  long_description: { severity: "notice", label: "Description too long", fix: "Google cuts descriptions off after about 160 characters." },
  no_h1: { severity: "warning", label: "No main heading", fix: "Each page should have one main heading (H1) saying what it's about." },
  many_h1: { severity: "notice", label: "More than one main heading", fix: "Use one main heading (H1) per page, and smaller headings for the sections." },
  missing_alt: { severity: "warning", label: "Images without alt text", fix: "Describe each image in its alt text. Google reads it, and so do screen readers." },
  slow: { severity: "warning", label: "Slow pages", fix: `These pages took over ${SLOW_MS / 1000} seconds to answer. Large images and many apps are the usual cause.` },
  no_sitemap: { severity: "error", label: "No sitemap", fix: "Google finds your pages from /sitemap.xml. Shopify makes one, so check the store isn't password protected." },
} as const satisfies Record<string, { severity: Severity; label: string; fix: string }>;

export type Code = keyof typeof CHECKS;
export type Finding = { url: string; detail?: string };
export type Issue = { code: Code; pages: Finding[] };

export type Page = {
  url: string;
  status: number;
  ms: number;
  title: string | null;
  description: string | null;
  h1: number;
  images: number;
  missingAlt: number;
  noindex: boolean;
  links: string[];
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};

// What the audit needs from one page's HTML. Links are kept when they stay on the store.
export function readPage(html: string, pageUrl: string): Omit<Page, "status" | "ms" | "url"> {
  const body = html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];
  const metas = body.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (name: string) => metas.find((m) => attr(m, "name")?.toLowerCase() === name);
  const description = meta("description");
  const robots = meta("robots");
  const imgs = body.match(/<img\b[^>]*>/gi) ?? [];
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const links = new Set<string>();
  for (const a of body.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(a, "href");
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const u = new URL(decode(href), pageUrl);
      if ((u.protocol === "https:" || u.protocol === "http:") && u.hostname.replace(/^www\./, "") === host) {
        u.hash = "";
        links.add(u.toString());
      }
    } catch {
      // Not an address.
    }
  }
  return {
    title: title ? decode(title) || null : null,
    description: description ? decode(attr(description, "content") ?? "") || null : null,
    h1: (body.match(/<h1[\s>]/gi) ?? []).length,
    images: imgs.length,
    missingAlt: imgs.filter((i) => !(attr(i, "alt") ?? "").trim()).length,
    noindex: !!robots && /noindex/i.test(attr(robots, "content") ?? ""),
    links: [...links],
  };
}

// The addresses listed in a sitemap, or in each sitemap a sitemap index lists.
export function sitemapUrls(xml: string) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
}

// The problems across every page read.
export function findIssues(pages: Page[], brokenLinks: { from: string; url: string; status: number }[], sitemap: boolean): Issue[] {
  const issues = new Map<Code, Finding[]>();
  const add = (code: Code, f: Finding) => issues.set(code, [...(issues.get(code) ?? []), f]);
  if (!sitemap) add("no_sitemap", { url: "/sitemap.xml" });
  const ok = pages.filter((p) => p.status < 400);
  for (const p of pages) if (p.status >= 400) add("broken_page", { url: p.url, detail: `Answered ${p.status}` });
  for (const b of brokenLinks) add("broken_link", { url: b.from, detail: `Links to ${b.url}, which answered ${b.status}` });
  const dupes = (key: "title" | "description") => {
    const by = new Map<string, Page[]>();
    for (const p of ok) if (p[key]) by.set(p[key]!.toLowerCase(), [...(by.get(p[key]!.toLowerCase()) ?? []), p]);
    return [...by.values()].filter((g) => g.length > 1);
  };
  for (const p of ok) {
    if (p.noindex) add("noindex", { url: p.url });
    if (!p.title) add("no_title", { url: p.url });
    else if (p.title.length > 60) add("long_title", { url: p.url, detail: `${p.title.length} characters: ${p.title}` });
    if (!p.description) add("no_description", { url: p.url });
    else if (p.description.length > 160) add("long_description", { url: p.url, detail: `${p.description.length} characters` });
    if (p.h1 === 0) add("no_h1", { url: p.url });
    if (p.h1 > 1) add("many_h1", { url: p.url, detail: `${p.h1} main headings` });
    if (p.missingAlt) add("missing_alt", { url: p.url, detail: `${p.missingAlt} of ${p.images} images` });
    if (p.ms > SLOW_MS) add("slow", { url: p.url, detail: `${(p.ms / 1000).toFixed(1)} seconds` });
  }
  for (const g of dupes("title")) for (const p of g) add("duplicate_title", { url: p.url, detail: p.title! });
  for (const g of dupes("description")) for (const p of g) add("duplicate_description", { url: p.url });
  const rank: Record<Severity, number> = { error: 0, warning: 1, notice: 2 };
  return [...issues]
    .map(([code, pages]) => ({ code, pages }))
    .sort((a, b) => rank[CHECKS[a.code].severity] - rank[CHECKS[b.code].severity] || b.pages.length - a.pages.length);
}

// 100 when every page passes every check. Errors count three times as much as warnings.
export function auditScore(pages: number, issues: Issue[]) {
  if (!pages) return 0;
  const weight: Record<Severity, number> = { error: 3, warning: 1, notice: 0.25 };
  const lost = issues.reduce((sum, i) => sum + weight[CHECKS[i.code].severity] * i.pages.length, 0);
  return Math.max(0, Math.round(100 - (100 * lost) / (pages * 6)));
}

export type TimedFetcher = (url: string, accept: string) => Promise<{ status: number; url: string; body: string; ms: number }>;

const timed =
  (fetcher: Fetcher): TimedFetcher =>
  async (url, accept) => {
    const start = Date.now();
    const res = await fetcher(url, accept);
    return { ...res, ms: Date.now() - start };
  };

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// The home page plus a sample of each part of the sitemap.
async function pagesToRead(origin: string, get: TimedFetcher) {
  const urls = [`${origin}/`];
  let sitemap = false;
  try {
    const index = await get(`${origin}/sitemap.xml`, "application/xml");
    if (index.status < 400 && /<(urlset|sitemapindex)\b/i.test(index.body)) {
      sitemap = true;
      const listed = sitemapUrls(index.body);
      const children = /<sitemapindex\b/i.test(index.body) ? listed : [];
      if (!children.length) urls.push(...listed.slice(0, PER_SITEMAP * 4));
      for (const child of children.slice(0, 8)) {
        const res = await get(child, "application/xml").catch(() => null);
        if (res && res.status < 400) urls.push(...sitemapUrls(res.body).slice(0, PER_SITEMAP));
      }
    }
  } catch {
    // No sitemap.
  }
  return { urls: [...new Set(urls)].filter((u) => !/\.(jpe?g|png|gif|webp|pdf)(\?|$)/i.test(u)).slice(0, MAX_PAGES), sitemap };
}

// Reads the store and keeps what it found. Claims the shop first so two
// checks can't run at once.
export async function runAudit(shop: string, { fetcher = fetchPublic, now = new Date() }: { fetcher?: Fetcher; now?: Date } = {}) {
  const domain = await shopDomain(shop);
  if (!domain) return { error: "Add your store's website on the Keyword gap page first." };
  await db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });
  const { count } = await db.shopSettings.updateMany({
    where: { shop, OR: [{ auditRunningAt: null }, { auditRunningAt: { lt: new Date(now.getTime() - STUCK) } }] },
    data: { auditRunningAt: now },
  });
  if (!count) return { error: "A check is already running." };
  const get = timed(fetcher);
  try {
    const origin = `https://${domain}`;
    const home = await get(`${origin}/`, "text/html").catch((err: Error) => err);
    if (home instanceof Error || home.status >= 500) throw new Error(home instanceof Error ? home.message : `your store answered with an error (${home.status})`);
    if (/\/password\/?$/.test(new URL(home.url).pathname)) throw new Error("your store is password protected, so search engines can't read it either");

    const { urls, sitemap } = await pagesToRead(origin, get);
    const pages: Page[] = [];
    await inBatches(urls, AT_ONCE, async (url) => {
      const res = await get(url, "text/html").catch(() => null);
      if (!res) return;
      pages.push({ url, status: res.status, ms: res.ms, ...(res.status < 400 ? readPage(res.body, res.url) : readPage("", url)) });
    });

    // Links found on the pages read, other than to the pages themselves.
    const read = new Set(pages.map((p) => p.url));
    const linkedFrom = new Map<string, string>();
    for (const p of pages) for (const l of p.links) if (!read.has(l) && !linkedFrom.has(l) && !/\/(cart|account|checkout|search)/.test(new URL(l).pathname)) linkedFrom.set(l, p.url);
    const broken: { from: string; url: string; status: number }[] = [];
    await inBatches([...linkedFrom].slice(0, MAX_LINKS), AT_ONCE, async ([url, from]) => {
      const res = await get(url, "text/html").catch(() => null);
      if (res && res.status >= 400) broken.push({ from, url, status: res.status });
    });

    pages.sort((a, b) => a.url.localeCompare(b.url));
    const issues = findIssues(pages, broken, sitemap).map((i) => ({ ...i, pages: i.pages.slice(0, 100) }));
    await db.siteAudit.create({ data: { shop, ranAt: now, domain, pages: pages.length, score: auditScore(pages.length, issues), issues: JSON.stringify(issues) } });
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.siteAudit.create({ data: { shop, ranAt: now, domain, error: `Couldn't read your store: ${message}`.slice(0, 300) } });
    return { error: `Couldn't read your store: ${message}` };
  } finally {
    const old = await db.siteAudit.findMany({ where: { shop }, orderBy: { ranAt: "desc" }, skip: KEEP_RUNS, select: { id: true } });
    if (old.length) await db.siteAudit.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    await db.shopSettings.update({ where: { shop }, data: { auditRunningAt: null } });
  }
}

// A check the merchant starts, run in the background.
export async function startAudit(shop: string, { fetcher = fetchPublic, now = new Date() }: { fetcher?: Fetcher; now?: Date } = {}) {
  if (!(await shopDomain(shop))) return { error: "Add your store's website on the Keyword gap page first." };
  const [s, last] = await Promise.all([db.shopSettings.findUnique({ where: { shop } }), db.siteAudit.findFirst({ where: { shop }, orderBy: { ranAt: "desc" } })]);
  if (s?.auditRunningAt && now.getTime() - s.auditRunningAt.getTime() < STUCK) return { error: "A check is already running." };
  if (last && now.getTime() - last.ranAt.getTime() < MIN_GAP) return { error: "Your store was checked in the last hour. Try again later." };
  void runAudit(shop, { fetcher, now }).catch((err) => console.error("Site audit failed", shop, err));
  return { started: true as const };
}

// The weekly run, from the hourly schedule.
export async function refreshAllAudits({ fetcher = fetchPublic, now = new Date() }: { fetcher?: Fetcher; now?: Date } = {}) {
  for (const s of await db.shopSettings.findMany({ where: { domain: { not: null } }, select: { shop: true } })) {
    const last = await db.siteAudit.findFirst({ where: { shop: s.shop }, orderBy: { ranAt: "desc" } });
    if (last && now.getTime() - last.ranAt.getTime() < WEEK) continue;
    await runAudit(s.shop, { fetcher, now }).catch((err) => console.error("Site audit failed", s.shop, err));
  }
}

const parse = (json: string): Issue[] => {
  try {
    return JSON.parse(json) as Issue[];
  } catch {
    return [];
  }
};

// Everything the site audit page shows.
export async function auditOverview(shop: string, now = new Date()) {
  const [settings, domain, runs] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopDomain(shop),
    db.siteAudit.findMany({ where: { shop }, orderBy: { ranAt: "desc" }, take: KEEP_RUNS }),
  ]);
  const last = runs[0];
  const done = runs.filter((r) => r.score != null);
  const latest = done[0];
  const issues = latest ? parse(latest.issues) : [];
  const count = (sev: Severity) => issues.filter((i) => CHECKS[i.code].severity === sev).reduce((n, i) => n + i.pages.length, 0);
  return {
    domain,
    running: !!settings?.auditRunningAt && now.getTime() - settings.auditRunningAt.getTime() < STUCK,
    error: last?.error ?? null,
    checkedAt: latest?.ranAt.toISOString() ?? null,
    pages: latest?.pages ?? 0,
    score: latest?.score ?? null,
    before: done[1]?.score ?? null,
    counts: { error: count("error"), warning: count("warning"), notice: count("notice") },
    issues: issues.map((i) => ({ ...i, ...CHECKS[i.code] })),
  };
}
