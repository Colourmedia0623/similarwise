import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { findContacts, outreachList, setOutreachStatus, startOutreach, writeFollowUp } from "./outreach.server";
import type { Fetcher } from "../tracker/fetch.server";

const SHOP = "outreach.myshopify.com";

const pages: Record<string, string> = {
  "https://giftblog.com/": `<html><head><title>Gift Blog | Ideas for every occasion</title><meta name="description" content="Gift guides and reviews."></head>
    <body><a href="/contact-us">Contact</a><a href="/shop">Shop</a><a href="https://other.com/contact">x</a><img src="logo@2x.png">
    <a href="mailto:hello@gmail.com">x</a></body></html>`,
  "https://giftblog.com/contact-us": `<p>Write to editor&#64;giftblog.com or ads [at] partner.com</p>`,
};
const fetcher: Fetcher = async (url) => ({ status: pages[url] ? 200 : 404, url, body: pages[url] ?? "" });

describe("outreach emails", () => {
  beforeEach(async () => {
    await db.outreach.deleteMany({ where: { shop: SHOP } });
    await db.competitor.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("finds a site's title and contact addresses, its own domain first", async () => {
    expect(await findContacts("giftblog.com", fetcher)).toEqual({
      title: "Gift Blog | Ideas for every occasion",
      description: "Gift guides and reviews.",
      emails: ["editor@giftblog.com", "hello@gmail.com", "ads@partner.com"],
    });
  });

  it("writes the email, then tracks sending, follow-ups and the outcome", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, domain: "mine.com" } });
    await db.competitor.create({
      data: { shop: SHOP, name: "Rival", url: "https://rival.com", linksDomain: "mine.com", links: { create: [{ domain: "giftblog.com", rank: 40 }] } },
    });
    let given: Record<string, unknown> = {};
    const ask = async (_s: string, input: unknown) => {
      given = input as Record<string, unknown>;
      return { subject: "A gift box for your guides", body: "Hello, ... [Your name]" };
    };
    const started = await startOutreach(SHOP, "giftblog.com", { ask, fetcher });
    if (!("id" in started) || !started.id) throw new Error("not started");
    expect(given).toMatchObject({ site: "giftblog.com", siteTitle: "Gift Blog | Ideas for every occasion" });
    expect(await startOutreach(SHOP, "giftblog.com", { ask, fetcher })).toEqual({ id: started.id });

    const sent = new Date("2026-10-01T09:00:00Z");
    await setOutreachStatus(SHOP, started.id, "sent", sent);
    let [row] = await outreachList(SHOP, new Date("2026-10-05T09:00:00Z"));
    expect(row).toMatchObject({ to: "editor@giftblog.com", status: "sent", followUpDue: false });
    [row] = await outreachList(SHOP, new Date("2026-10-09T09:00:00Z"));
    expect(row.followUpDue).toBe(true);

    expect(await writeFollowUp(SHOP, started.id, async () => ({ subject: "x", body: "Following up ... [Your name]" }))).toEqual({ ok: true });
    [row] = await outreachList(SHOP);
    expect(row).toMatchObject({ subject: "Re: A gift box for your guides", status: "draft", followUps: 1 });
    expect(await setOutreachStatus(SHOP, started.id, "nonsense")).toEqual({ error: "Unknown status" });
  });
});
