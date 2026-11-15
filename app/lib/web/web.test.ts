import { describe, expect, it } from "vitest";
import db from "../../db.server";
import { hashPassword, isShopifyRequest, safeNext, startSession, verifyPassword, webAccount, createWorkspace, signupAllowed } from "./auth.server";
import { cleanWebsite, isWebShop, newWebShop } from "./shop";
import { webAdminContext, workspaceSubscriptions } from "./context.server";

const cookieOf = (setCookie: string) => setCookie.split(";")[0];

describe("web workspaces' shop keys", () => {
  it("never look like a Shopify store", () => {
    const shop = newWebShop("AbC-123_xyz");
    expect(shop).toBe("ws-abc123xyz.web.similarwise");
    expect(isWebShop(shop)).toBe(true);
    expect(isWebShop("gift-boxes.myshopify.com")).toBe(false);
  });

  it("reads a website however it's typed", () => {
    expect(cleanWebsite("https://www.Gift.co.uk/shop?x=1")).toBe("gift.co.uk");
    expect(cleanWebsite("candles.com")).toBe("candles.com");
    expect(cleanWebsite("not a site")).toBeNull();
    expect(cleanWebsite("")).toBeNull();
  });
});

describe("web logins", () => {
  it("hashes passwords", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });

  it("leaves requests from Shopify admin to Shopify", () => {
    expect(isShopifyRequest(new Request("https://x/app?shop=a.myshopify.com&host=abc"))).toBe(true);
    expect(isShopifyRequest(new Request("https://x/app", { headers: { authorization: "Bearer abc" } }))).toBe(true);
    expect(isShopifyRequest(new Request("https://x/app/competitors"))).toBe(false);
  });

  it("only sends people back to app pages", () => {
    expect(safeNext("/app/keywords")).toBe("/app/keywords");
    expect(safeNext("https://evil.example")).toBe("/app");
    expect(safeNext("//evil.example")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
  });

  it("signs a browser in to its workspace, as the app pages see it", async () => {
    const user = await db.webUser.create({ data: { email: `t${Date.now()}@example.com`, passwordHash: await hashPassword("password1") } });
    const cookie = cookieOf(await startSession(user.id, null));
    const req = () => new Request("https://x/app/competitors", { headers: { cookie, accept: "text/html" } });

    const before = await webAccount(req());
    expect(before?.user.id).toBe(user.id);
    expect(before?.workspace).toBeNull();
    await expect(webAdminContext(req())).rejects.toMatchObject({ status: 302, headers: expect.any(Headers) });

    const ws = await createWorkspace(before!, { name: "Candle Co", website: "candleco.co.uk", platform: "woocommerce", country: "GB" });
    const ctx = await webAdminContext(req());
    expect(ctx?.session.shop).toBe(ws.shop);
    // No store: Admin API queries answer with no data rather than failing.
    const answer = await (await ctx!.admin.graphql()).json();
    expect(answer.data).toBeNull();
    // A new workspace starts on the free trial.
    const subs = await workspaceSubscriptions(ws.id);
    expect(subs[0]).toMatchObject({ id: "trial", name: "Advertise (monthly)", trialDays: 7 });

    // The same cookie with Shopify's own markers is left to Shopify.
    expect(await webAdminContext(new Request("https://x/app?shop=a.myshopify.com", { headers: { cookie } }))).toBeNull();
  });

  it("sends signed-out visitors to the login page, and leaves other requests to Shopify", async () => {
    await expect(webAdminContext(new Request("https://x/app/ads", { headers: { accept: "text/html" } }))).rejects.toMatchObject({ status: 302 });
    expect(await webAdminContext(new Request("https://x/app/ads", { method: "POST" }))).toBeNull();
  });

  it("lets waitlisted and invited people sign up until sign-ups open", async () => {
    delete process.env.WEB_SIGNUP;
    process.env.WEB_INVITES = "invited@example.com";
    await db.waitlistEntry.upsert({ where: { email: "waiting@example.com" }, create: { email: "waiting@example.com" }, update: {} });
    expect(await signupAllowed("invited@example.com")).toBe(true);
    expect(await signupAllowed("waiting@example.com")).toBe(true);
    expect(await signupAllowed("stranger@example.com")).toBe(false);
    process.env.WEB_SIGNUP = "open";
    expect(await signupAllowed("stranger@example.com")).toBe(true);
    delete process.env.WEB_SIGNUP;
  });
});

describe("super admins", () => {
  it("can sign up, get every page free, and give other workspaces free access", async () => {
    const { isAdminEmail, setWorkspaceFree, adminOverview } = await import("./admin.server");
    process.env.ADMIN_EMAILS = "boss@example.com, Other@Example.com";
    expect(isAdminEmail("BOSS@example.com")).toBe(true);
    expect(isAdminEmail("other@example.com")).toBe(true);
    expect(isAdminEmail("someone@example.com")).toBe(false);
    expect(await signupAllowed("boss@example.com")).toBe(true);

    const boss = await db.webUser.upsert({ where: { email: "boss@example.com" }, create: { email: "boss@example.com" }, update: {} });
    const cookie = cookieOf(await startSession(boss.id, null));
    const account = await webAccount(new Request("https://x/app", { headers: { cookie } }));
    const own = await createWorkspace(account!, { name: "Colourmedia", website: null, platform: "none", country: "GB" });
    expect((await workspaceSubscriptions(own.id))[0]).toMatchObject({ id: "free", name: "Advertise (yearly)" });

    const client = await db.workspace.create({ data: { name: "Client", shop: newWebShop(`cl${Date.now()}`) } });
    expect(await workspaceSubscriptions(client.id)).toEqual([]);
    await setWorkspaceFree(client.id, true);
    expect((await workspaceSubscriptions(client.id))[0]?.id).toBe("free");
    const overview = await adminOverview();
    expect(overview.workspaces.find((w) => w.id === client.id)?.status).toBe("Free");
    delete process.env.ADMIN_EMAILS;
  });
});
