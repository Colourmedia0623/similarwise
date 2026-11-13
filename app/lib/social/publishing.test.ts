import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import db from "../../db.server";
import { connectPinterest, type Fetch } from "./networks.server";
import { createPinterestBoard, saveAccounts, socialAccounts } from "./social.server";
import {
  calendarData,
  deleteCampaign,
  deleteSocialPost,
  duplicatePost,
  instagramCopy,
  movePost,
  retryPost,
  saveCampaign,
  savePost,
  sendDuePosts,
  uploadSocialImage,
  type PostInput,
} from "./publishing.server";
import { fromZoned, zoned } from "./when";

const SHOP = "calendar.myshopify.com";
const NOW = new Date("2026-11-13T10:00:00Z");

type Call = { url: string; body: string; auth?: string };

function fakeFetch(routes: [RegExp, unknown][], calls: Call[]): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? ""), auth: new Headers(init?.headers).get("authorization") ?? undefined });
    const hit = routes.find(([re]) => re.test(url));
    return new Response(JSON.stringify(hit ? hit[1] : { error: { message: `unexpected ${url}` } }), { status: hit ? 200 : 400 });
  }) as Fetch;
}

async function picture(width = 1200, height = 800) {
  const data = await sharp({ create: { width, height, channels: 3, background: "#cc6633" } })
    .png()
    .toBuffer();
  const res = await uploadSocialImage(SHOP, { type: "image/png", size: data.length, arrayBuffer: async () => new Uint8Array(data).buffer });
  if (!("imageId" in res)) throw new Error(res.error);
  return res;
}

async function accounts() {
  await saveAccounts(SHOP, [
    { network: "facebook", accountId: "p1", name: "Candle Co", token: "page-token" },
    { network: "instagram", accountId: "ig1", name: "@candleco", token: "page-token" },
  ]);
  return Object.fromEntries((await socialAccounts(SHOP)).map((x) => [x.network, x.id]));
}

const input = (extra: Partial<PostInput>): PostInput => ({
  caption: "Autumn candles are in #candles",
  captions: {},
  accountIds: [],
  tiktok: {},
  link: "",
  campaignId: "",
  imageId: null,
  mode: "schedule",
  day: "2026-11-14",
  time: "09:00",
  tz: "Europe/London",
  ...extra,
});

describe("social calendar", () => {
  beforeEach(async () => {
    process.env.SOCIAL_APPROVED = "meta";
    for (const t of [db.scheduledPost, db.socialImage, db.socialCampaign, db.socialPost, db.socialAccount] as const)
      await (t as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop: SHOP } });
  });

  it("reads and writes times on the shop's clock", () => {
    expect(fromZoned("2026-11-14", "09:00", "Europe/London")!.toISOString()).toBe("2026-11-14T09:00:00.000Z");
    expect(fromZoned("2026-07-14", "09:00", "Europe/London")!.toISOString()).toBe("2026-07-14T08:00:00.000Z");
    expect(fromZoned("2026-11-14", "09:00", "America/New_York")!.toISOString()).toBe("2026-11-14T14:00:00.000Z");
    expect(zoned(new Date("2026-11-14T03:30:00Z"), "America/Los_Angeles")).toEqual({ day: "2026-11-13", time: "19:30" });
  });

  it("checks a post can go out before scheduling it, but keeps rough drafts", async () => {
    const ids = await accounts();
    expect(await savePost(SHOP, input({ accountIds: [] }), { now: NOW })).toEqual({ error: "Pick at least one account to post to." });
    expect(await savePost(SHOP, input({ accountIds: [ids.instagram] }), { now: NOW })).toEqual({ error: "Instagram needs a picture. Add one to the post." });
    expect(await savePost(SHOP, input({ accountIds: [ids.facebook], day: "2026-11-13", time: "09:00" }), { now: NOW })).toMatchObject({ error: expect.stringMatching(/passed/) });
    expect(await savePost(SHOP, input({ accountIds: [ids.facebook], link: "candles.com" }), { now: NOW })).toMatchObject({ error: expect.stringMatching(/https/) });
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    const img = await picture();
    expect(await savePost(SHOP, input({ accountIds: [ids.instagram], imageId: img.imageId, caption: tags }), { now: NOW })).toMatchObject({ error: expect.stringMatching(/30 hashtags/) });
    const draft = await savePost(SHOP, input({ mode: "draft", accountIds: [], caption: "half an idea", day: "" }), { now: NOW });
    expect(draft).toMatchObject({ status: "draft" });
    expect(await db.scheduledPost.findFirstOrThrow({ where: { shop: SHOP } })).toMatchObject({ status: "draft", scheduledAt: null });
  });

  it("sends due posts once, with each network's caption and a picture it accepts", async () => {
    const ids = await accounts();
    const img = await picture(600, 1200);
    const saved = await savePost(
      SHOP,
      input({ accountIds: [ids.facebook, ids.instagram], imageId: img.imageId, link: "https://candles.example/autumn", captions: { instagram: "Autumn is here\n#candles #autumn" } }),
      { now: NOW },
    );
    expect(saved).toMatchObject({ status: "scheduled" });
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/p1\/photos/, { id: "ph1", post_id: "p1_1" }],
        [/ig1\/media_publish/, { id: "m1" }],
        [/ig1\/media$/, { id: "c1" }],
        [/m1\?/, { permalink: "https://instagram.com/p/a" }],
      ],
      calls,
    );
    expect(await sendDuePosts({ f, now: new Date("2026-11-14T08:59:00Z") })).toBe(0);
    expect(await sendDuePosts({ f, now: new Date("2026-11-14T09:00:30Z") })).toBe(1);
    expect(await sendDuePosts({ f, now: new Date("2026-11-14T09:01:30Z") })).toBe(0);
    const photo = new URLSearchParams(calls.find((c) => c.url.includes("p1/photos"))!.body);
    expect(photo.get("caption")).toBe("Autumn candles are in #candles\n\nhttps://candles.example/autumn");
    expect(photo.get("url")).toMatch(new RegExp(`/social-images/${img.imageId}\\.jpg$`));
    const media = new URLSearchParams(calls.find((c) => /ig1\/media$/.test(c.url))!.body);
    expect(media.get("caption")).toBe("Autumn is here\n#candles #autumn");
    expect(media.get("image_url")).toMatch(/\?for=instagram$/);
    const data = await calendarData(SHOP, NOW);
    expect(data.posts[0]).toMatchObject({ status: "sent", sentAt: "2026-11-14T09:00:30.000Z" });
    expect(data.posts[0].results.map((r) => [r.network, r.status, r.url])).toEqual([
      ["facebook", "posted", "https://www.facebook.com/p1_1"],
      ["instagram", "posted", "https://instagram.com/p/a"],
    ]);
    // A sent post can't be changed, only duplicated.
    expect(await savePost(SHOP, input({ id: data.posts[0].id, accountIds: [ids.facebook] }), { now: NOW })).toMatchObject({ error: expect.stringMatching(/Duplicate/) });
    const copy = await duplicatePost(SHOP, data.posts[0].id);
    expect(await db.scheduledPost.findUniqueOrThrow({ where: { id: (copy as { id: string }).id } })).toMatchObject({ status: "draft", scheduledAt: null });
  });

  it("keeps TikTok closed until TikTok approves the app", async () => {
    await saveAccounts(SHOP, [{ network: "tiktok", accountId: "tt1", name: "Tok", token: "t" }]);
    const [tiktok] = await socialAccounts(SHOP);
    const img = await picture();
    const choices = { privacy: "SELF_ONLY", allowComments: false, yourBrand: false, brandedContent: false };
    const post = input({ accountIds: [tiktok.id], imageId: img.imageId, tiktok: { [tiktok.id]: choices } });
    expect((await calendarData(SHOP, NOW)).accounts).toEqual([]);
    expect(await savePost(SHOP, post, { now: NOW })).toEqual({ error: "Posting to TikTok isn't open yet." });
    process.env.SOCIAL_APPROVED = "meta,tiktok";
    expect(await savePost(SHOP, { ...post, tiktok: {} }, { now: NOW })).toMatchObject({ error: expect.stringMatching(/who can see/) });
    expect(await savePost(SHOP, post, { now: NOW })).toMatchObject({ status: "scheduled" });
  });

  it("connects each Pinterest board and pins to it, refreshing the shared token", async () => {
    process.env.SOCIAL_APPROVED = "meta,pinterest";
    process.env.PINTEREST_APP_ID = "pin-app";
    process.env.PINTEREST_APP_SECRET = "pin-secret";
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/oauth\/token/, { access_token: "pin-token", refresh_token: "pin-refresh", expires_in: 3600 }],
        [/user_account/, { username: "candleco" }],
        [/boards\?/, { items: [{ id: "b1", name: "Autumn" }, { id: "b2", name: "Gifts" }], bookmark: null }],
        [/\/pins$/, { id: "991" }],
      ],
      calls,
    );
    const boards = await connectPinterest("code1", f, NOW);
    expect(boards.map((b) => [b.accountId, b.name])).toEqual([
      ["b1", "candleco: Autumn"],
      ["b2", "candleco: Gifts"],
    ]);
    expect(calls[0].body).toContain("grant_type=authorization_code");
    await saveAccounts(SHOP, boards);
    const [autumn] = await socialAccounts(SHOP);
    const img = await picture();
    await savePost(SHOP, input({ accountIds: [autumn.id], imageId: img.imageId, link: "https://candles.example/autumn", caption: "Autumn candles\nThree new scents #candles" }), {
      now: NOW,
    });
    calls.length = 0;
    // Two hours later the token has run out, so it's refreshed first, for both boards.
    expect(await sendDuePosts({ f, now: new Date("2026-11-14T12:00:00Z") })).toBe(1);
    expect(calls[0].url).toMatch(/oauth\/token/);
    const pin = JSON.parse(calls.find((c) => /\/pins$/.test(c.url))!.body);
    expect(pin).toMatchObject({ board_id: "b1", title: "Autumn candles", link: "https://candles.example/autumn", media_source: { source_type: "image_url" } });
    expect(pin.media_source.url).toMatch(new RegExp(`/social-images/${img.imageId}\\.jpg$`));
    const rows = await db.socialAccount.findMany({ where: { shop: SHOP, network: "pinterest" } });
    expect(rows.every((r) => r.tokenExpiresAt!.getTime() > new Date("2026-11-14T12:00:00Z").getTime())).toBe(true);
    expect((await calendarData(SHOP, NOW)).posts[0].results[0]).toMatchObject({ status: "posted", url: "https://www.pinterest.com/pin/991/" });
  });

  it("makes a first Pinterest board when the account has none", async () => {
    process.env.PINTEREST_APP_ID = "pin-app";
    process.env.PINTEREST_APP_SECRET = "pin-secret";
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/oauth\/token/, { access_token: "pin-token", refresh_token: "pin-refresh", expires_in: 3600 }],
        [/user_account/, { username: "x9", business_name: "Colourmedia" }],
        [/boards\?/, { items: [], bookmark: null }],
        [/\/boards$/, { id: "b9", name: "Colourmedia products" }],
      ],
      calls,
    );
    expect((await connectPinterest("code1", f, NOW)).map((b) => [b.accountId, b.name])).toEqual([["b9", "Colourmedia: Colourmedia products"]]);
    expect(JSON.parse(calls.find((c) => /\/boards$/.test(c.url))!.body)).toEqual({ name: "Colourmedia products", privacy: "PUBLIC" });
  });

  it("makes a board the merchant names, sharing the Pinterest token", async () => {
    await saveAccounts(SHOP, [{ network: "pinterest", accountId: "b1", name: "candleco: Autumn", token: "pin-token", refreshToken: "r", expiresAt: new Date(NOW.getTime() + 86400_000) }]);
    const calls: Call[] = [];
    const f = fakeFetch([[/\/boards$/, { id: "b2", name: "Gift ideas" }]], calls);
    expect(await createPinterestBoard(SHOP, "  ", { f, now: NOW })).toEqual({ error: "Give the board a name." });
    expect(await createPinterestBoard(SHOP, "Gift ideas", { f, now: NOW })).toEqual({ ok: true, name: "Gift ideas" });
    expect(JSON.parse(calls[0].body)).toEqual({ name: "Gift ideas", privacy: "PUBLIC" });
    expect((await socialAccounts(SHOP)).map((a) => a.name).sort()).toEqual(["candleco: Autumn", "candleco: Gift ideas"]);
  });

  it("keeps Pinterest boards and pins in the sandbox while the app has trial access", async () => {
    process.env.PINTEREST_API = "https://api-sandbox.pinterest.com/v5";
    process.env.PINTEREST_SANDBOX_TOKEN = "sandbox-token";
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/oauth\/token/, { access_token: "pin-token", refresh_token: "r", expires_in: 3600 }],
        [/user_account/, { business_name: "Colourmedia" }],
        [/boards\?/, { items: [{ id: "s1", name: "Sandbox board" }], bookmark: null }],
      ],
      calls,
    );
    await connectPinterest("code1", f, NOW);
    delete process.env.PINTEREST_API;
    delete process.env.PINTEREST_SANDBOX_TOKEN;
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.pinterest.com", "api.pinterest.com", "api-sandbox.pinterest.com"]);
    // The sandbox only accepts the app's own sandbox token.
    expect(calls.slice(1).map((c) => c.auth)).toEqual(["Bearer pin-token", "Bearer sandbox-token"]);
  });

  it("pads tall pictures for Instagram", async () => {
    const tall = await sharp({ create: { width: 400, height: 1000, channels: 3, background: "#000" } })
      .jpeg()
      .toBuffer();
    const meta = await sharp(await instagramCopy(new Uint8Array(tall), 400, 1000)).metadata();
    expect([meta.width, meta.height]).toEqual([800, 1000]);
  });

  it("retries only the accounts that failed", async () => {
    const ids = await accounts();
    const img = await picture();
    await savePost(SHOP, input({ accountIds: [ids.facebook, ids.instagram], imageId: img.imageId }), { now: NOW });
    const calls: Call[] = [];
    const facebookOnly = fakeFetch([[/p1\/photos/, { id: "ph1", post_id: "p1_1" }]], calls);
    await sendDuePosts({ f: facebookOnly, now: new Date("2026-11-14T09:00:00Z") });
    let post = (await calendarData(SHOP, NOW)).posts[0];
    expect(post.status).toBe("partial");
    expect(post.results.find((r) => r.network === "instagram")).toMatchObject({ status: "failed", error: expect.stringMatching(/^Instagram said/) });
    const all = fakeFetch(
      [
        [/p1\/photos/, { id: "ph2", post_id: "p1_2" }],
        [/ig1\/media_publish/, { id: "m1" }],
        [/ig1\/media$/, { id: "c1" }],
        [/m1\?/, { permalink: "https://instagram.com/p/a" }],
      ],
      calls,
    );
    calls.length = 0;
    expect(await retryPost(SHOP, post.id, { f: all, now: NOW })).toMatchObject({ status: "sent" });
    expect(calls.some((c) => c.url.includes("p1/photos"))).toBe(false);
    post = (await calendarData(SHOP, NOW)).posts[0];
    expect(post.results.map((r) => r.status).sort()).toEqual(["posted", "posted"]);
  });

  it("moves posts between days, and campaigns can go without their posts", async () => {
    const ids = await accounts();
    const c = (await saveCampaign(SHOP, { name: "Autumn launch", color: "#e8590c", startDay: "2026-11-14", endDay: "2026-11-20", note: "" })) as { id: string };
    expect(await saveCampaign(SHOP, { name: "Bad", color: "#000", startDay: "2026-11-20", endDay: "2026-11-14", note: "" })).toMatchObject({ error: expect.any(String) });
    const saved = (await savePost(SHOP, input({ accountIds: [ids.facebook], campaignId: c.id }), { now: NOW })) as { id: string };
    expect(await movePost(SHOP, saved.id, "2026-11-16", "09:00", "Europe/London", NOW)).toEqual({ ok: true });
    expect((await db.scheduledPost.findUniqueOrThrow({ where: { id: saved.id } })).scheduledAt?.toISOString()).toBe("2026-11-16T09:00:00.000Z");
    expect(await movePost(SHOP, saved.id, "2026-11-12", "09:00", "Europe/London", NOW)).toMatchObject({ error: expect.stringMatching(/passed/) });
    await deleteCampaign(SHOP, c.id);
    expect((await db.scheduledPost.findUniqueOrThrow({ where: { id: saved.id } })).campaignId).toBeNull();
    await deleteSocialPost(SHOP, saved.id);
    expect(await db.scheduledPost.count({ where: { shop: SHOP } })).toBe(0);
  });
});
