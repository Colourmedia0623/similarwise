import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { authorizeUrl, connectMeta, type Fetch } from "./networks.server";
import { readState, seal, signState, unseal } from "./seal.server";
import { autoShare, saveAccounts, shareArticle, socialAccounts } from "./social.server";

const SHOP = "social.myshopify.com";
const NOW = new Date("2026-10-18T09:00:00Z");

type Call = { url: string; body: string; auth: string | null };

// Answers each request from a list of [url pattern, JSON] pairs, keeping what was sent.
function fakeFetch(routes: [RegExp, unknown][], calls: Call[]): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? ""), auth: new Headers(init?.headers).get("authorization") });
    const hit = routes.find(([re]) => re.test(url));
    return new Response(JSON.stringify(hit ? hit[1] : { error: { message: `unexpected ${url}` } }), { status: hit ? 200 : 400 });
  }) as Fetch;
}

async function article(status = "published") {
  return db.blogArticle.create({
    data: { shop: SHOP, keyword: "gift box ideas", title: "Gift box ideas", summary: "S", bodyHtml: "<p>x</p>", metaTitle: "M", metaDescription: "D", status, url: "https://old.example/blogs/news/gift-box-ideas", imageAlt: "Gift box" },
  });
}

describe("social sharing", () => {
  beforeEach(async () => {
    await db.socialPost.deleteMany({ where: { shop: SHOP } });
    await db.socialAccount.deleteMany({ where: { shop: SHOP } });
    await db.articleImage.deleteMany({ where: { shop: SHOP } });
    await db.blogArticle.deleteMany({ where: { shop: SHOP } });
    await db.shopSettings.deleteMany({ where: { shop: SHOP } });
  });

  it("keeps tokens sealed and only trusts its own sign-in state", () => {
    const sealed = seal("secret-token");
    expect(sealed).not.toContain("secret-token");
    expect(unseal(sealed)).toBe("secret-token");
    const state = signState({ shop: SHOP, network: "meta", exp: NOW.getTime() + 60_000 });
    expect(readState(state, NOW.getTime())).toMatchObject({ shop: SHOP, network: "meta" });
    expect(readState(state, NOW.getTime() + 120_000)).toBeNull();
    expect(readState(state.replace(/.$/, (c) => (c === "A" ? "B" : "A")), NOW.getTime())).toBeNull();
  });

  it("signs in to Meta with the Login for Business configuration when there is one", () => {
    process.env.META_APP_ID = "app1";
    delete process.env.META_CONFIG_ID;
    expect(new URL(authorizeUrl("meta", "s")).searchParams.get("scope")).toContain("pages_manage_posts");
    process.env.META_CONFIG_ID = "cfg1";
    const q = new URL(authorizeUrl("meta", "s")).searchParams;
    expect([q.get("config_id"), q.get("scope"), q.get("response_type")]).toEqual(["cfg1", null, "code"]);
    delete process.env.META_CONFIG_ID;
  });

  it("connects each Facebook Page and the Instagram account linked to it", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/oauth\/access_token\?.*code=abc/, { access_token: "short" }],
        [/oauth\/access_token\?.*fb_exchange_token=short/, { access_token: "long" }],
        [/me\/accounts/, { data: [{ id: "p1", name: "Gift Boxes 3000", access_token: "page-token", instagram_business_account: { id: "ig1", username: "giftboxes3000" } }, { id: "p2", name: "Other", access_token: "t2" }] }],
      ],
      calls,
    );
    const accounts = await connectMeta("abc", f);
    expect(accounts.map((a) => [a.network, a.accountId, a.name, a.token])).toEqual([
      ["facebook", "p1", "Gift Boxes 3000", "page-token"],
      ["instagram", "ig1", "@giftboxes3000", "page-token"],
      ["facebook", "p2", "Other", "t2"],
    ]);
    await saveAccounts(SHOP, accounts);
    await saveAccounts(SHOP, accounts.slice(0, 1));
    expect((await socialAccounts(SHOP)).length).toBe(3);
    expect((await db.socialAccount.findFirstOrThrow({ where: { shop: SHOP, accountId: "p1" } })).token).not.toBe("page-token");
  });

  it("posts to Facebook and Instagram with the article's link and picture, refreshing TikTok's token", async () => {
    const a = await article();
    await db.articleImage.create({ data: { articleId: a.id, shop: SHOP, data: new Uint8Array([1]), createdAt: NOW } });
    await saveAccounts(SHOP, [
      { network: "facebook", accountId: "p1", name: "Page", token: "page-token" },
      { network: "instagram", accountId: "ig1", name: "@ig", token: "page-token" },
      { network: "tiktok", accountId: "tt1", name: "Tok", token: "old", refreshToken: "refresh", expiresAt: new Date(NOW.getTime() - 1000) },
    ]);
    const ids = Object.fromEntries((await socialAccounts(SHOP)).map((x) => [x.network, x.id]));
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/p1\/feed/, { id: "p1_99" }],
        [/ig1\/media_publish/, { id: "m1" }],
        [/ig1\/media$/, { id: "c1" }],
        [/m1\?/, { permalink: "https://instagram.com/p/x" }],
        [/oauth\/token/, { access_token: "fresh", refresh_token: "refresh2", expires_in: 86400, open_id: "tt1" }],
        [/creator_info/, { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }],
        [/content\/init/, { data: { publish_id: "pub1" }, error: { code: "ok" } }],
      ],
      calls,
    );
    const res = await shareArticle(
      SHOP,
      a.id,
      [
        { accountId: ids.facebook, caption: "Read this" },
        { accountId: ids.instagram, caption: "Look #gifts" },
        { accountId: ids.tiktok, caption: "Tok #gifts" },
      ],
      { f, origin: "https://gift-boxes-3000.myshopify.com", now: NOW },
    );
    expect(res).toEqual({ posted: 3, failed: 0 });
    const feed = new URLSearchParams(calls.find((c) => c.url.includes("p1/feed"))!.body);
    expect(feed.get("link")).toBe("https://gift-boxes-3000.myshopify.com/blogs/news/gift-box-ideas");
    expect(new URLSearchParams(calls.find((c) => /ig1\/media$/.test(c.url))!.body).get("image_url")).toMatch(new RegExp(`/images/${a.id}\\.jpg\\?v=${NOW.getTime()}$`));
    const init = JSON.parse(calls.find((c) => c.url.includes("content/init"))!.body);
    expect(init).toMatchObject({ media_type: "PHOTO", post_info: { privacy_level: "SELF_ONLY" } });
    expect(calls.find((c) => c.url.includes("content/init"))!.auth).toBe("Bearer fresh");
    const posts = await db.socialPost.findMany({ where: { shop: SHOP }, orderBy: { network: "asc" } });
    expect(posts.map((p) => [p.network, p.status, p.url])).toEqual([
      ["facebook", "posted", "https://www.facebook.com/p1_99"],
      ["instagram", "posted", "https://instagram.com/p/x"],
      ["tiktok", "processing", null],
    ]);
  });

  it("won't share an article that isn't published, and keeps a failed post's reason", async () => {
    const draft = await article("draft");
    await saveAccounts(SHOP, [{ network: "facebook", accountId: "p1", name: "Page", token: "t" }]);
    const [acc] = await socialAccounts(SHOP);
    expect(await shareArticle(SHOP, draft.id, [{ accountId: acc.id, caption: "x" }])).toEqual({ error: expect.stringMatching(/Publish the article/) });
    const live = await article();
    const f = fakeFetch([], []);
    expect(await shareArticle(SHOP, live.id, [{ accountId: acc.id, caption: "x" }], { f })).toEqual({ error: expect.stringMatching(/^Facebook said: unexpected/) });
    expect((await db.socialPost.findFirstOrThrow({ where: { articleId: live.id } })).status).toBe("failed");
  });

  it("shares calendar articles automatically only when switched on", async () => {
    const a = await article();
    await saveAccounts(SHOP, [{ network: "facebook", accountId: "p1", name: "Page", token: "t" }]);
    const calls: Call[] = [];
    const f = fakeFetch([[/p1\/feed/, { id: "p1_1" }]], calls);
    const ask = async () => ({ facebook: "New on the blog", instagram: "i", tiktok: "t" });
    await autoShare(SHOP, a.id, { ask, f });
    expect(calls).toHaveLength(0);
    await db.shopSettings.create({ data: { shop: SHOP, socialAuto: true } });
    await autoShare(SHOP, a.id, { ask, f });
    await autoShare(SHOP, a.id, { ask, f });
    expect(calls).toHaveLength(1);
    expect(new URLSearchParams(calls[0].body).get("message")).toBe("New on the blog");
  });
});
