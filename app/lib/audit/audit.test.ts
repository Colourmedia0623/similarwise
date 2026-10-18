import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { Fetcher } from "../tracker/fetch.server";
import { auditOverview, auditScore, findIssues, readPage, runAudit, sitemapUrls, startAudit, type Page } from "./audit.server";

const SHOP = "audit.myshopify.com";
const NOW = new Date("2026-10-18T09:00:00Z");

const html = (o: { title?: string; description?: string; h1?: number; body?: string } = {}) =>
  `<html><head>${o.title != null ? `<title>${o.title}</title>` : ""}${o.description != null ? `<meta name="description" content="${o.description}">` : ""}</head><body>${"<h1>Heading</h1>".repeat(o.h1 ?? 1)}${o.body ?? ""}</body></html>`;

const page = (url: string, o: Partial<Page> = {}): Page => ({ url, status: 200, ms: 200, title: `Title ${url}`, description: `About ${url}`, h1: 1, images: 0, missingAlt: 0, noindex: false, links: [], ...o });

describe("site audit", () => {
  beforeEach(async () => {
    await db.siteAudit.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.create({ data: { shop: SHOP, domain: "giftboxes.co.uk" } });
  });

  it("reads a page's title, description, headings, images and links on the store", () => {
    const p = readPage(
      `<title> Gift &amp; Boxes </title><meta content="Boxes for every occasion" name="description"><meta name="robots" content="noindex,follow">
       <h1>One</h1><h1 class="x">Two</h1><script><h1>not this</h1></script>
       <img src="a.jpg" alt="A box"><img src="b.jpg"><img src="c.jpg" alt=" ">
       <a href="/collections/all#top">All</a><a href="https://www.giftboxes.co.uk/pages/about">About</a><a href="https://other.com/x">Other</a><a href="mailto:a@b.c">Mail</a>`,
      "https://giftboxes.co.uk/",
    );
    expect(p).toEqual({
      title: "Gift & Boxes",
      description: "Boxes for every occasion",
      h1: 2,
      images: 3,
      missingAlt: 2,
      noindex: true,
      links: ["https://giftboxes.co.uk/collections/all", "https://www.giftboxes.co.uk/pages/about"],
    });
    expect(sitemapUrls("<urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc></url></urlset>")).toEqual(["https://a.com/x?a=1&b=2"]);
  });

  it("lists problems worst first and scores the site", () => {
    const pages = [
      page("https://s.com/"),
      page("https://s.com/a", { title: "Same", description: null, h1: 0 }),
      page("https://s.com/b", { title: "Same", ms: 4200, missingAlt: 2, images: 3 }),
      page("https://s.com/gone", { status: 404 }),
    ];
    const issues = findIssues(pages, [{ from: "https://s.com/", url: "https://s.com/old", status: 404 }], true);
    expect(issues.map((i) => i.code)).toEqual(["broken_page", "broken_link", "duplicate_title", "no_description", "no_h1", "missing_alt", "slow"]);
    expect(issues.find((i) => i.code === "slow")!.pages).toEqual([{ url: "https://s.com/b", detail: "4.2 seconds" }]);
    expect(auditScore(4, issues)).toBe(50);
    expect(auditScore(4, [])).toBe(100);
  });

  it("reads the home page and the sitemap's pages, and finds broken links", async () => {
    const site: Record<string, { status: number; body: string }> = {
      "https://giftboxes.co.uk/": { status: 200, body: html({ title: "Home", description: "Gift boxes", body: '<a href="/pages/old">Old</a><a href="/cart">Cart</a>' }) },
      "https://giftboxes.co.uk/sitemap.xml": { status: 200, body: "<sitemapindex><sitemap><loc>https://giftboxes.co.uk/sitemap_products_1.xml</loc></sitemap></sitemapindex>" },
      "https://giftboxes.co.uk/sitemap_products_1.xml": { status: 200, body: "<urlset><url><loc>https://giftboxes.co.uk/products/box</loc></url><url><loc>https://giftboxes.co.uk/products/gone</loc></url></urlset>" },
      "https://giftboxes.co.uk/products/box": { status: 200, body: html({ title: "Box", h1: 0 }) },
    };
    const fetcher: Fetcher = async (url) => ({ url, ...(site[url] ?? { status: 404, body: "Not found" }) });
    expect(await runAudit(SHOP, { fetcher, now: NOW })).toEqual({ ok: true });
    const view = await auditOverview(SHOP, NOW);
    expect(view.pages).toBe(3);
    expect(Object.fromEntries(view.issues.map((i) => [i.code, i.pages.map((p) => p.url)]))).toEqual({
      broken_page: ["https://giftboxes.co.uk/products/gone"],
      broken_link: ["https://giftboxes.co.uk/"],
      no_description: ["https://giftboxes.co.uk/products/box"],
      no_h1: ["https://giftboxes.co.uk/products/box"],
    });
    expect(view.counts).toEqual({ error: 2, warning: 2, notice: 0 });
    expect(view.running).toBe(false);
    expect(await startAudit(SHOP, { fetcher, now: new Date(NOW.getTime() + 60_000) })).toEqual({ error: expect.stringMatching(/last hour/) });
  });

  it("says why when the store can't be read", async () => {
    const fetcher: Fetcher = async () => ({ url: "https://giftboxes.co.uk/password", status: 200, body: "" });
    expect(await runAudit(SHOP, { fetcher, now: NOW })).toEqual({ error: expect.stringMatching(/password protected/) });
    expect((await auditOverview(SHOP, NOW)).error).toMatch(/password protected/);
  });
});
