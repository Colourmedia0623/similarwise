import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { appCategory, detectStorefront } from "./detect";
import { refreshOwnTech, techOverview } from "./tech.server";
import type { Fetcher } from "./fetch.server";

const SHOP = "tech.myshopify.com";
const page = (scripts: string[]): Fetcher => async (url) => ({
  status: 200,
  url,
  body: `<script>Shopify.theme = {"name":"Mine","schema_name":"Dawn"};</script>${scripts.map((s) => `<script src="https://${s}/x.js"></script>`).join("")}`,
});

describe("website technologies", () => {
  beforeEach(async () => {
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("knows what each app does", () => {
    const s = detectStorefront('<script src="https://widget.trustpilot.com/a.js"></script><script src="https://cdn.weglot.com/w.js"></script>');
    expect(s.apps).toEqual(["Trustpilot", "Weglot"]);
    expect(appCategory("Trustpilot")).toBe("Reviews");
    expect(appCategory("Gone app")).toBeNull();
  });

  it("sets the shop's own apps beside its competitors' and lists the common ones it lacks", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    const now = new Date();
    const rival = (name: string, apps: string[]) =>
      db.competitor.create({
        data: { shop: SHOP, name, url: `https://${name.toLowerCase()}.com`, apps: JSON.stringify(apps), lastCheckedAt: now, isShopify: true, theme: "Impulse" },
      });
    const a = await rival("A", ["Klaviyo", "Judge.me"]);
    const b = await rival("B", ["Klaviyo", "Weglot"]);
    await rival("C", ["Klaviyo"]);

    const fetched: string[] = [];
    const fetcher: Fetcher = async (url, accept) => {
      fetched.push(url);
      return page(["static.klaviyo.com", "cdn.loox.io"])(url, accept);
    };
    await refreshOwnTech(SHOP, { fetcher, now });
    await refreshOwnTech(SHOP, { fetcher, now });
    expect(fetched).toEqual(["https://mine.com"]);

    const t = await techOverview(SHOP);
    expect(t.own).toEqual({ theme: "Dawn", read: true, error: null });
    expect(t.groups.map((g) => g.category)).toEqual(["Email & SMS", "Reviews", "Translation"]);
    expect(t.groups[1].rows).toEqual([
      { name: "Judge.me", you: false, users: [a.id] },
      { name: "Loox", you: true, users: [] },
    ]);
    expect(t.groups[2].rows).toEqual([{ name: "Weglot", you: false, users: [b.id] }]);
    // Klaviyo is used by all three, but the shop has it too.
    expect(t.missing).toEqual([]);

    await refreshOwnTech(SHOP, { fetcher: page([]), force: true, now });
    expect((await techOverview(SHOP)).missing.map((m) => m.name)).toEqual(["Klaviyo"]);
  });

  it("says when the shop's store can't be read", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    await refreshOwnTech(SHOP, { fetcher: async () => ({ status: 200, url: "https://mine.com/password", body: "" }) });
    const t = await techOverview(SHOP);
    expect(t.own).toEqual({ theme: null, read: false, error: "Couldn't read your store: your store is password protected" });
  });
});
