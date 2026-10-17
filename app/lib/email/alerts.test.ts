import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { detectAlertEmail, digestEmail, parseTopics, sendAlerts, sendDigests } from "./alerts.server";
import { unsubscribeUrl, verifyUnsubscribe, type Email } from "./send.server";

const SHOP = "mine.myshopify.com";
const MONDAY = new Date("2026-10-19T08:00:00Z");

let outbox: Email[] = [];
const send = async (e: Email) => {
  outbox.push(e);
};

async function rival(name = "Rival") {
  return db.competitor.create({ data: { shop: SHOP, name, url: `https://${name.toLowerCase()}.com` } });
}

const event = (competitorId: string, kind: string, message: string, createdAt: Date) =>
  db.competitorEvent.create({ data: { competitorId, kind, message, createdAt } });

beforeEach(async () => {
  await db.competitor.deleteMany();
  await db.shopSettings.deleteMany();
  await db.shopProduct.deleteMany();
  outbox = [];
});

describe("alert emails", () => {
  it("starts from now, then bundles new changes into one email", async () => {
    const start = new Date("2026-10-17T10:00:00Z");
    await db.shopSettings.create({ data: { shop: SHOP, alertEmail: "me@shop.com" } });
    const c = await rival();
    await event(c.id, "launch", "Launched Old thing", new Date("2026-10-16T10:00:00Z"));

    expect(await sendAlerts({ send, now: start })).toBe(0); // History isn't emailed.
    await event(c.id, "price_down", "Cut Gift box from £5.00 to £4.00", new Date("2026-10-17T10:30:00Z"));
    await event(c.id, "launch", "Launched <Big> box", new Date("2026-10-17T10:40:00Z"));
    await event(c.id, "tracking", "Started tracking", new Date("2026-10-17T10:45:00Z"));

    expect(await sendAlerts({ send, now: new Date("2026-10-17T11:00:00Z") })).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "me@shop.com", subject: "Rival: 2 changes" });
    expect(outbox[0].text).toContain("Price cut: Cut Gift box from £5.00 to £4.00");
    expect(outbox[0].html).toContain("Launched &lt;Big&gt; box");
    expect(outbox[0].html).not.toContain("Started tracking");
    expect(outbox[0].unsubscribeUrl).toContain("list=alerts");

    expect(await sendAlerts({ send, now: new Date("2026-10-17T12:00:00Z") })).toBe(0);
    expect(outbox).toHaveLength(1);
  });

  it("only sends the topics the merchant picked, and nothing when off", async () => {
    await db.shopSettings.create({
      data: { shop: SHOP, alertEmail: "me@shop.com", alertTopics: '["ads"]', alertsSentAt: new Date("2026-10-17T00:00:00Z") },
    });
    const c = await rival();
    await event(c.id, "price_down", "Cut a price", new Date("2026-10-17T01:00:00Z"));
    expect(await sendAlerts({ send, now: new Date("2026-10-17T02:00:00Z") })).toBe(0);
    await event(c.id, "channel_added", "Started using TikTok (ads)", new Date("2026-10-17T03:00:00Z"));
    await db.shopSettings.update({ where: { shop: SHOP }, data: { alertsOn: false } });
    expect(await sendAlerts({ send, now: new Date("2026-10-17T04:00:00Z") })).toBe(0);
    await db.shopSettings.update({ where: { shop: SHOP }, data: { alertsOn: true } });
    expect(await sendAlerts({ send, now: new Date("2026-10-17T05:00:00Z") })).toBe(1);
    expect(outbox[0].subject).toBe("Rival: new ad channel");
  });

  it("tries again when sending fails", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, alertEmail: "me@shop.com", alertsSentAt: new Date("2026-10-17T00:00:00Z") } });
    const c = await rival();
    await event(c.id, "launch", "Launched Box", new Date("2026-10-17T01:00:00Z"));
    const broken = async () => {
      throw new Error("Resend answered 500");
    };
    expect(await sendAlerts({ send: broken, now: new Date("2026-10-17T02:00:00Z") })).toBe(0);
    expect(await sendAlerts({ send, now: new Date("2026-10-17T03:00:00Z") })).toBe(1);
  });

  it("does nothing without a mailer", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, alertEmail: "me@shop.com" } });
    expect(await sendAlerts({ send: null })).toBe(0);
    expect((await db.shopSettings.findUniqueOrThrow({ where: { shop: SHOP } })).alertsSentAt).toBeNull();
  });
});

describe("the weekly summary", () => {
  it("goes out once on Monday morning with the week's changes", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, alertEmail: "me@shop.com" } });
    const c = await rival();
    await rival("Other");
    await event(c.id, "price_down", "Cut Box from £5.00 to £4.00", new Date("2026-10-17T10:00:00Z"));
    await event(c.id, "price_down", "Cut Bag from £2.00 to £1.50", new Date("2026-10-18T10:00:00Z"));
    await event(c.id, "launch", "Launched Bow", new Date("2026-10-10T10:00:00Z")); // Last week.

    expect(await sendDigests({ send, now: new Date("2026-10-18T08:00:00Z") })).toBe(0); // Sunday.
    expect(await sendDigests({ send, now: new Date("2026-10-19T06:00:00Z") })).toBe(0); // Too early.
    expect(await sendDigests({ send, now: MONDAY })).toBe(1);
    expect(await sendDigests({ send, now: new Date("2026-10-19T09:00:00Z") })).toBe(0);
    expect(outbox[0].subject).toBe("Your week: 2 competitor changes");
    expect(outbox[0].text).toContain("Rival: 2 × price cut");
    expect(outbox[0].text).not.toContain("Bow");
    expect(outbox[0].unsubscribeUrl).toContain("list=digest");

    expect(await sendDigests({ send, now: new Date("2026-10-26T08:00:00Z") })).toBe(1);
    expect(outbox[1].subject).toBe("Your week: no competitor changes");
  });

  it("includes price comparison and keyword gap highlights", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, alertEmail: "me@shop.com", domain: "mine.com" } });
    const c = await db.competitor.create({
      data: {
        shop: SHOP,
        name: "Rival",
        url: "https://rival.com",
        currency: "GBP",
        gapAt: MONDAY,
        gapDomain: "mine.com",
        products: { create: [{ productId: "1", handle: "box", title: "Kraft gift box", priceCents: 300 }] },
        gaps: { create: [{ keyword: "gift boxes", searchVolume: 12000, theirPosition: 2, theirTraffic: 900 }] },
      },
      include: { products: true },
    });
    const own = await db.shopProduct.create({
      data: { shop: SHOP, productId: "gid://shopify/Product/1", handle: "box", title: "Kraft gift box", priceCents: 400, currency: "GBP", syncedAt: MONDAY },
    });
    await db.productMatch.create({ data: { shopProductId: own.id, competitorId: c.id, competitorProductId: c.products[0].id, confirmed: true } });

    const email = (await digestEmail(SHOP, "me@shop.com", MONDAY))!;
    expect(email.text).toContain("a competitor is cheaper on 1 of 1 matched products");
    expect(email.text).toContain("Kraft gift box: Rival sells it for £3.00, 25% less than your £4.00");
    expect(email.text).toContain('"gift boxes": 12,000 searches a month, Rival is #2');
  });

  it("skips shops with no competitors", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, alertEmail: "me@shop.com" } });
    expect(await sendDigests({ send, now: MONDAY })).toBe(0);
  });
});

describe("settings", () => {
  it("fills in the shop's email once, and reads topics safely", async () => {
    await detectAlertEmail(SHOP, async () => "owner@shop.com");
    await detectAlertEmail(SHOP, async () => "other@shop.com");
    expect((await db.shopSettings.findUniqueOrThrow({ where: { shop: SHOP } })).alertEmail).toBe("owner@shop.com");
    expect(parseTopics('["prices","bogus"]')).toEqual(["prices"]);
    expect(parseTopics("not json")).toEqual([]);
  });

  it("signs unsubscribe links", () => {
    const url = new URL(unsubscribeUrl(SHOP, "digest"), "https://x.test");
    const sig = url.searchParams.get("sig")!;
    expect(verifyUnsubscribe(SHOP, "digest", sig)).toBe(true);
    expect(verifyUnsubscribe(SHOP, "alerts", sig)).toBe(false);
    expect(verifyUnsubscribe("other.myshopify.com", "digest", sig)).toBe(false);
    expect(verifyUnsubscribe(SHOP, "digest", "nope")).toBe(false);
  });
});
