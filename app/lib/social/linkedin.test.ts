import { describe, expect, it } from "vitest";
import { authorizeUrl, connectLinkedIn, linkedInText, postLinkedIn, type Fetch } from "./networks.server";
import { sendTo } from "./social.server";

const NOW = new Date("2026-11-14T10:00:00Z");

type Call = { url: string; method: string; body: unknown; headers: Headers };
type Answer = { json?: unknown; status?: number; headers?: Record<string, string>; bytes?: Uint8Array };

// Answers each call from the first route whose pattern matches its address.
function fakeFetch(routes: [RegExp, Answer | (() => Answer)][], calls: Call[]): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body, headers: new Headers(init?.headers) });
    const route = routes.find(([re]) => re.test(url))?.[1];
    const hit = typeof route === "function" ? route() : route;
    if (!hit) return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 400 });
    if (hit.bytes) return new Response(Buffer.from(hit.bytes), { status: 200 });
    return new Response(hit.json === undefined ? null : JSON.stringify(hit.json), { status: hit.status ?? 200, headers: hit.headers });
  }) as Fetch;
}

describe("LinkedIn", () => {
  it("asks to sign in with OpenID Connect and post as the member", () => {
    process.env.LINKEDIN_CLIENT_ID = "li-app";
    const url = new URL(authorizeUrl("linkedin", "st"));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("client_id")).toBe("li-app");
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("connects the member's profile with a 60-day token", async () => {
    process.env.LINKEDIN_CLIENT_ID = "li-app";
    process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        [/accessToken/, { json: { access_token: "li-token", expires_in: 5184000 } }],
        [/userinfo/, { json: { sub: "abc123", name: "Chris Example" } }],
      ],
      calls,
    );
    const [account] = await connectLinkedIn("code1", f, NOW);
    expect(account).toMatchObject({ network: "linkedin", accountId: "abc123", name: "Chris Example", token: "li-token", refreshToken: null });
    expect(account.expiresAt?.toISOString()).toBe("2027-01-13T10:00:00.000Z");
    expect(String(calls[0].body)).toContain("client_secret=li-secret");
    expect(calls[1].headers.get("authorization")).toBe("Bearer li-token");
  });

  it("escapes LinkedIn's special characters and keeps hashtags", () => {
    expect(linkedInText("Autumn (new) candles_ #CandleLovers #gifts")).toBe("Autumn \\(new\\) candles\\_ {hashtag|\\#|CandleLovers} {hashtag|\\#|gifts}");
  });

  it("uploads each picture and posts them together, with the link under the caption", async () => {
    const calls: Call[] = [];
    let n = 0;
    const f = fakeFetch(
      [
        [/social-images/, { bytes: new Uint8Array([1, 2, 3]) }],
        [/images\?action=initializeUpload/, () => ({ json: { value: { uploadUrl: `https://upload.test/${++n}`, image: `urn:li:image:${n}` } } })],
        [/upload\.test/, { status: 201 }],
        [/rest\/posts/, { status: 201, headers: { "x-restli-id": "urn:li:share:77" } }],
      ],
      calls,
    );
    const done = await postLinkedIn(
      "abc123",
      "li-token",
      { caption: "New gift boxes", title: "Gift boxes", link: "https://shop.test/gifts", imageUrl: "https://app.test/social-images/1.jpg", images: ["https://app.test/social-images/1.jpg", "https://app.test/social-images/2.jpg"] },
      f,
    );
    expect(done).toEqual({ remoteId: "urn:li:share:77", url: "https://www.linkedin.com/feed/update/urn:li:share:77/" });
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual(["https://upload.test/1", "https://upload.test/2"]);
    const post = calls.find((c) => /rest\/posts/.test(c.url))!;
    expect(post.headers.get("linkedin-version")).toMatch(/^\d{6}$/);
    expect(JSON.parse(String(post.body))).toMatchObject({
      author: "urn:li:person:abc123",
      commentary: "New gift boxes\n\nhttps://shop.test/gifts",
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      content: { multiImage: { images: [{ id: "urn:li:image:1" }, { id: "urn:li:image:2" }] } },
    });
  });

  it("posts a link card when there's no picture", async () => {
    const calls: Call[] = [];
    const f = fakeFetch([[/rest\/posts/, { status: 201, headers: { "x-restli-id": "urn:li:share:8" } }]], calls);
    await postLinkedIn("abc123", "li-token", { caption: "Read our guide", title: "Guide", link: "https://shop.test/guide", imageUrl: "" }, f);
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ commentary: "Read our guide", content: { article: { source: "https://shop.test/guide", title: "Guide" } } });
  });

  it("says what LinkedIn refused", async () => {
    const f = fakeFetch([[/rest\/posts/, { status: 403, json: { message: "Not enough permissions" } }]], []);
    await expect(postLinkedIn("abc123", "li-token", { caption: "Hi", title: "Hi", link: "", imageUrl: "" }, f)).rejects.toThrow("Not enough permissions");
  });

  it("asks the merchant to connect again once the token has run out", async () => {
    const account = { id: "x", shop: "s", network: "linkedin", accountId: "abc123", token: "sealed", refreshToken: null, tokenExpiresAt: new Date(NOW.getTime() - 1000) };
    await expect(sendTo(account, { caption: "Hi", title: "Hi", link: "", imageUrl: "" }, undefined, fakeFetch([], []), NOW)).rejects.toThrow("Connect LinkedIn again");
  });
});
