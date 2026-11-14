import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import type { Fetch } from "../social/networks.server";
import { saveAccounts, socialAccounts, disconnectAccount } from "../social/social.server";
import { authorizeUrl } from "../social/networks.server";
import { answer, assign, draftReply, inboxOpen, inboxView, saveMember, saveRule, setStatus, syncShop, syncShopIfStale, type RuleInput } from "./inbox.server";
import { fillReply, matchesWords } from "./inbox";

const SHOP = "inbox.myshopify.com";
const T0 = new Date("2026-11-14T10:00:00Z");
const later = (min: number) => new Date(T0.getTime() + min * 60_000);

type Call = { url: string; body: string; method: string };

// Answers each request with the first route whose pattern matches; the
// routes can change between calls to stand for new comments arriving.
function fakeFetch(routes: () => [RegExp, unknown, number?][], calls: Call[]): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? ""), method: init?.method ?? "GET" });
    const hit = routes().find(([re]) => re.test(url));
    return new Response(JSON.stringify(hit ? hit[1] : { error: { message: `unexpected ${url}` } }), { status: hit ? (hit[2] ?? 200) : 400 });
  }) as Fetch;
}

const comment = (id: string, from: { id: string; name: string }, message: string, at: Date, replies: unknown[] = []) => ({
  id,
  message,
  created_time: at.toISOString(),
  from,
  comments: { data: replies },
});

const ann = { id: "u1", name: "Ann Smith" };
const page = { id: "p1", name: "Candle Co" };

function world() {
  const state = {
    fbComments: [comment("c1", ann, "Where is my order #1001?", T0)] as unknown[],
    dms: [
      {
        id: "t_1",
        participants: { data: [page, { id: "psid9", name: "Bob Jones" }] },
        messages: { data: [{ id: "m_1", message: "Do you ship to Ireland?", created_time: T0.toISOString(), from: { id: "psid9", name: "Bob Jones" } }] },
      },
    ] as unknown[],
    igComments: [{ id: "ig_c1", text: "Love these candles!", timestamp: T0.toISOString(), username: "cara", from: { id: "igu1", username: "cara" }, replies: { data: [] } }] as unknown[],
  };
  const routes = (): [RegExp, unknown, number?][] => [
    [/\/p1\/feed\?/, { data: [{ id: "p1_post1", message: "Autumn candles are in", permalink_url: "https://facebook.com/p1/posts/1", comments: { data: state.fbComments } }] }],
    [/\/me\/conversations\?.*platform=messenger/, { data: state.dms }],
    [/\/me\/conversations\?.*platform=instagram/, { data: [] }],
    [/\/ig1\/media\?/, { data: [{ id: "media1", caption: "New scents", permalink: "https://instagram.com/p/1", comments: { data: state.igComments } }] }],
    [/\/c\w+\/comments$/, { id: "c1_reply" }],
    [/\/ig_c1\/replies$/, { id: "ig_r1" }],
    [/\/me\/messages$/, { message_id: "m_sent" }],
  ];
  return { state, routes };
}

async function connect() {
  await saveAccounts(SHOP, [
    { network: "facebook", accountId: "p1", name: "Candle Co", token: "page-token" },
    { network: "instagram", accountId: "ig1", name: "@candleco", token: "page-token" },
    { network: "tiktok", accountId: "tt1", name: "candleco", token: "tt-token" },
  ]);
  return Object.fromEntries((await socialAccounts(SHOP)).map((x) => [x.network, x.id]));
}

const rule = (r: Partial<RuleInput>): RuleInput => ({ name: "Rule", on: true, networks: [], kinds: [], words: [], sentiment: "", addTags: [], assignTo: "", reply: "", resolve: false, ...r });

describe("social inbox", () => {
  beforeEach(async () => {
    process.env.INBOX_APPROVED = "facebook,instagram";
    for (const t of [db.inboxMessage, db.inboxThread, db.inboxRule, db.inboxMember, db.socialAccount, db.socialPost] as const)
      await (t as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { shop: SHOP } });
  });

  it("stays hidden until the network approves it", () => {
    process.env.INBOX_APPROVED = "";
    expect(inboxOpen(SHOP, "facebook")).toBe(false);
    expect(inboxOpen("gift-boxes-3000.myshopify.com", "instagram")).toBe(true);
    expect(inboxOpen("gift-boxes-3000.myshopify.com", "linkedin")).toBe(false);
    expect(inboxOpen("gift-boxes-3000.myshopify.com", "tiktok")).toBe(false);
    process.env.INBOX_APPROVED = "facebook,linkedin";
    expect(inboxOpen(SHOP, "facebook")).toBe(true);
    expect(inboxOpen(SHOP, "instagram")).toBe(false);
    expect(inboxOpen(SHOP, "linkedin")).toBe(true);
  });

  it("asks for the inbox permissions only where the inbox is open", () => {
    process.env.META_APP_ID = "app1";
    delete process.env.META_CONFIG_ID;
    expect(new URL(authorizeUrl("meta", "s")).searchParams.get("scope")).not.toContain("pages_messaging");
    const scope = new URL(authorizeUrl("meta", "s", { inbox: true })).searchParams.get("scope") ?? "";
    for (const s of ["pages_messaging", "pages_manage_engagement", "pages_read_user_content", "instagram_manage_comments", "instagram_manage_messages", "human_agent"]) expect(scope).toContain(s);
    expect(new URL(authorizeUrl("linkedin", "s", { inbox: true })).searchParams.get("scope")).toContain("r_member_social");
  });

  it("brings comments and messages from every account into one inbox", async () => {
    await connect();
    const { routes } = world();
    const calls: Call[] = [];
    await syncShop(SHOP, { f: fakeFetch(routes, calls), now: later(5), ask: null });
    const v = await inboxView(SHOP, {}, later(5));
    expect(v.threads.map((t) => [t.network, t.kind, t.contactName, t.lastText]).sort()).toEqual([
      ["facebook", "comment", "Ann Smith", "Where is my order #1001?"],
      ["facebook", "message", "Bob Jones", "Do you ship to Ireland?"],
      ["instagram", "comment", "@cara", "Love these candles!"],
    ]);
    expect(v.counts.open).toBe(3);
    expect(v.counts.unassigned).toBe(3);
    // TikTok can't be read.
    expect(calls.some((c) => c.url.includes("tiktok"))).toBe(false);
    // Reading again adds nothing.
    await syncShop(SHOP, { f: fakeFetch(routes, calls), now: later(10), ask: null });
    expect(await db.inboxMessage.count({ where: { shop: SHOP } })).toBe(3);
  });

  it("answers from SimilarWise on each network", async () => {
    await connect();
    const { routes } = world();
    const calls: Call[] = [];
    const f = fakeFetch(routes, calls);
    await syncShop(SHOP, { f, now: later(5), ask: null });
    const v = await inboxView(SHOP, {}, later(5));
    const by = (name: string) => v.threads.find((t) => t.contactName === name)!.id;

    expect(await answer(SHOP, by("Ann Smith"), "It's on its way!", { f, now: later(6), resolve: true })).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: expect.stringMatching(/\/c1\/comments$/) });
    expect(calls.at(-1)!.body).toContain("message=It%27s+on+its+way%21");

    expect(await answer(SHOP, by("@cara"), "Thank you!", { f, now: later(6) })).toEqual({ ok: true });
    expect(calls.at(-1)!.url).toMatch(/\/ig_c1\/replies$/);

    expect(await answer(SHOP, by("Bob Jones"), "Yes we do", { f, now: later(6) })).toEqual({ ok: true });
    const dm = new URLSearchParams(calls.at(-1)!.body);
    expect(JSON.parse(dm.get("recipient")!)).toEqual({ id: "psid9" });
    expect(dm.get("messaging_type")).toBe("RESPONSE");

    const after = await inboxView(SHOP, { box: "resolved" }, later(7));
    expect(after.threads.map((t) => t.contactName)).toEqual(["Ann Smith"]);
    expect(after.counts.resolvedToday).toBe(1);
    const annView = await inboxView(SHOP, { box: "all", thread: by("Ann Smith") }, later(7));
    expect(annView.selected?.messages.map((m) => [m.fromUs, m.text])).toEqual([
      [false, "Where is my order #1001?"],
      [true, "It's on its way!"],
    ]);
    expect(annView.selected?.lastFrom).toBe("us");
    expect(annView.selected?.waitingSince).toBeNull();

    // The reply comes back on the next read without being added twice.
    const w = world();
    w.state.fbComments = [comment("c1", ann, "Where is my order #1001?", T0, [comment("c1_reply", page, "It's on its way!", later(6))])];
    await syncShop(SHOP, { f: fakeFetch(w.routes, calls), now: later(8), ask: null });
    expect(await db.inboxMessage.count({ where: { threadId: by("Ann Smith") } })).toBe(2);
  });

  it("uses the human agent tag after 24 hours, and stops after seven days", async () => {
    await connect();
    const { routes } = world();
    const calls: Call[] = [];
    const f = fakeFetch(routes, calls);
    await syncShop(SHOP, { f, now: later(5), ask: null });
    const id = (await inboxView(SHOP, { kind: "message" }, later(5))).threads[0].id;
    expect(await answer(SHOP, id, "Sorry for the wait", { f, now: later(60 * 30) })).toEqual({ ok: true });
    const sent = new URLSearchParams(calls.at(-1)!.body);
    expect([sent.get("messaging_type"), sent.get("tag")]).toEqual(["MESSAGE_TAG", "HUMAN_AGENT"]);
    const late = await answer(SHOP, id, "Hello?", { f, now: later(60 * 24 * 8) });
    expect("error" in late && late.error).toMatch(/seven days/);
  });

  it("reopens a resolved conversation when they write again, and runs automations only on new messages", async () => {
    await connect();
    const w = world();
    const calls: Call[] = [];
    await saveRule(SHOP, rule({ name: "Order questions", words: ["order"], addTags: ["order status"], reply: "Hi {name}, DM us your order number." }));
    await saveRule(SHOP, rule({ name: "Goodbye", kinds: ["message"], words: ["goodbye", "thanks, that's all"], resolve: true }));
    await syncShop(SHOP, { f: fakeFetch(w.routes, calls), now: later(5), ask: null });
    // The first read is what was already there: no automated replies.
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    w.state.fbComments = [comment("c1", ann, "Where is my order #1001?", T0), comment("c2", { id: "u2", name: "Dee Ray" }, "Has my order shipped?", later(7))];
    w.state.dms = [
      {
        id: "t_1",
        participants: { data: [page, { id: "psid9", name: "Bob Jones" }] },
        messages: {
          data: [
            { id: "m_2", message: "Thanks, that's all. Goodbye!", created_time: later(8).toISOString(), from: { id: "psid9", name: "Bob Jones" } },
            { id: "m_1", message: "Do you ship to Ireland?", created_time: T0.toISOString(), from: { id: "psid9", name: "Bob Jones" } },
          ],
        },
      },
    ];
    await syncShop(SHOP, { f: fakeFetch(w.routes, calls), now: later(10), ask: null });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toMatch(/\/c2\/comments$/);
    expect(new URLSearchParams(posts[0].body).get("message")).toBe("Hi Dee, DM us your order number.");
    const v = await inboxView(SHOP, { box: "all" }, later(10));
    const dee = v.threads.find((t) => t.contactName === "Dee Ray")!;
    expect(dee.tags).toEqual(["order status"]);
    expect(dee.lastFrom).toBe("us");
    expect(v.threads.find((t) => t.contactName === "Bob Jones")!.status).toBe("resolved");

    // A rule answers a conversation once, however many times they write.
    w.state.fbComments = [comment("c2", { id: "u2", name: "Dee Ray" }, "Has my order shipped?", later(7), [comment("c2_more", { id: "u2", name: "Dee Ray" }, "Order 1002", later(12))])];
    await syncShop(SHOP, { f: fakeFetch(w.routes, calls), now: later(15), ask: null });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);

    // Bob writes again after it was resolved: it opens again.
    w.state.dms = [
      {
        id: "t_1",
        participants: { data: [page, { id: "psid9", name: "Bob Jones" }] },
        messages: { data: [{ id: "m_3", message: "Actually one more thing", created_time: later(20).toISOString(), from: { id: "psid9", name: "Bob Jones" } }] },
      },
    ];
    await syncShop(SHOP, { f: fakeFetch(w.routes, calls), now: later(21), ask: null });
    expect((await inboxView(SHOP, { box: "all" }, later(21))).threads.find((t) => t.contactName === "Bob Jones")!.status).toBe("open");
  });

  it("reads how each message feels and routes it to the teammate with the right skills", async () => {
    await connect();
    const w = world();
    await saveMember(SHOP, { name: "Sam", skills: ["order status", "delivery"], routing: true });
    await saveMember(SHOP, { name: "Lee", skills: [], routing: true });
    const [sam, lee] = (await db.inboxMember.findMany({ where: { shop: SHOP }, orderBy: { createdAt: "asc" } })).map((m) => m.id);
    await syncShop(SHOP, { f: fakeFetch(w.routes, []), now: later(5), ask: null });
    w.state.fbComments = [comment("c3", { id: "u3", name: "Eve" }, "My parcel never came, really annoyed", later(7))];
    w.state.igComments = [{ id: "ig_c2", text: "Gorgeous!", timestamp: later(7).toISOString(), username: "fay", from: { id: "igu2", username: "fay" } }];
    w.state.dms = [];
    const ask = async (_s: string, input: unknown) => ({
      conversations: (input as { conversations: { id: string; messages: { text: string }[] }[] }).conversations.map((c) =>
        c.messages.at(-1)!.text.includes("annoyed") ? { id: c.id, sentiment: "negative", tags: ["delivery"] } : { id: c.id, sentiment: "positive", tags: ["praise"] },
      ),
    });
    await syncShop(SHOP, { f: fakeFetch(w.routes, []), now: later(10), ask });
    const v = await inboxView(SHOP, { box: "all" }, later(10));
    const eve = v.threads.find((t) => t.contactName === "Eve")!;
    expect([eve.sentiment, eve.tags, eve.assignee]).toEqual(["negative", ["delivery"], sam]);
    expect(v.threads.find((t) => t.contactName === "@fay")!.assignee).toBe(lee);
    expect(v.sentiment.negative).toBe(1);
    expect((await inboxView(SHOP, { box: `member:${sam}` }, later(10))).threads.map((t) => t.contactName)).toEqual(["Eve"]);
    expect((await inboxView(SHOP, { tag: "delivery", box: "all" }, later(10))).threads.map((t) => t.contactName)).toEqual(["Eve"]);
  });

  it("searches, filters, assigns and resolves", async () => {
    await connect();
    await syncShop(SHOP, { f: fakeFetch(world().routes, []), now: later(5), ask: null });
    expect((await inboxView(SHOP, { q: "ireland" }, later(5))).threads.map((t) => t.contactName)).toEqual(["Bob Jones"]);
    expect((await inboxView(SHOP, { network: "instagram" }, later(5))).threads.map((t) => t.contactName)).toEqual(["@cara"]);
    await saveMember(SHOP, { name: "Sam", skills: [], routing: false });
    const sam = (await db.inboxMember.findFirstOrThrow({ where: { shop: SHOP } })).id;
    const ids = (await inboxView(SHOP, { network: "facebook" }, later(5))).threads.map((t) => t.id);
    expect(await assign(SHOP, ids, sam)).toEqual({ ok: true });
    let v = await inboxView(SHOP, {}, later(30));
    expect(v.counts.unassigned).toBe(1);
    expect(v.counts.members[sam]).toBe(2);
    // Waiting over an hour needs action even with someone on it.
    v = await inboxView(SHOP, {}, later(120));
    expect(v.counts.action).toBe(3);
    await setStatus(SHOP, ids, "resolved", later(121));
    v = await inboxView(SHOP, {}, later(122));
    expect([v.counts.open, v.counts.resolvedToday]).toEqual([1, 2]);
  });

  it("explains when Meta held back the permission", async () => {
    await connect();
    const routes = (): [RegExp, unknown, number?][] => [[/./, { error: { message: "(#10) This endpoint requires the 'pages_read_user_content' permission" } }, 400]];
    await syncShop(SHOP, { f: fakeFetch(routes, []), now: later(5), ask: null });
    const v = await inboxView(SHOP, {}, later(5));
    expect(v.accounts.find((a) => a.network === "facebook")!.error).toMatch(/Connect Facebook and Instagram again/);
  });

  it("shows Instagram comments when its direct messages are refused, and says which part is missing", async () => {
    await connect();
    const w = world();
    const routes = (): [RegExp, unknown, number?][] => [[/platform=instagram/, { error: { message: "(#3) Application does not have the capability to make this API call." } }, 400], ...w.routes()];
    await syncShop(SHOP, { f: fakeFetch(routes, []), now: later(5), ask: null });
    const v = await inboxView(SHOP, { network: "instagram" }, later(5));
    expect(v.threads.map((t) => t.contactName)).toEqual(["@cara"]);
    const ig = v.accounts.find((a) => a.network === "instagram")!;
    expect(ig.error).toMatch(/read direct messages/);
    expect(ig.error).toMatch(/does not have the capability/);
    expect(v.accounts.find((a) => a.network === "facebook")!.error).toBeNull();
  });

  it("reads again for an open page only when the last read is stale, and one read at a time", async () => {
    await connect();
    const calls: Call[] = [];
    const f = fakeFetch(world().routes, calls);
    expect(await syncShopIfStale(SHOP, 45_000, { f, now: later(5), ask: null })).toEqual({ synced: true });
    const n = calls.length;
    expect(await syncShopIfStale(SHOP, 45_000, { f, now: new Date(later(5).getTime() + 30_000), ask: null })).toEqual({ synced: false });
    expect(calls.length).toBe(n);
    expect(await syncShopIfStale(SHOP, 45_000, { f, now: later(6), ask: null })).toEqual({ synced: true });
    // Two reads at once: the second steps aside, so nothing is saved twice.
    const [a, b] = await Promise.all([syncShop(SHOP, { f, now: later(7), ask: null }), syncShop(SHOP, { f, now: later(7), ask: null })]);
    expect([a, b].filter((r) => "busy" in r)).toHaveLength(1);
    expect(await db.inboxMessage.count({ where: { shop: SHOP } })).toBe(3);
  });

  it("drafts a reply with Claude and clears the inbox when an account is disconnected", async () => {
    const ids = await connect();
    await syncShop(SHOP, { f: fakeFetch(world().routes, []), now: later(5), ask: null });
    const id = (await inboxView(SHOP, { kind: "message" }, later(5))).threads[0].id;
    let seen: unknown;
    const draft = await draftReply(SHOP, id, async (_s, input) => {
      seen = input;
      return { reply: "Yes, we ship to Ireland! 🇮🇪" };
    });
    expect(draft).toEqual({ reply: "Yes, we ship to Ireland! 🇮🇪" });
    expect(JSON.stringify(seen)).toContain("Do you ship to Ireland?");
    await disconnectAccount(SHOP, ids.facebook);
    expect(await db.inboxThread.count({ where: { shop: SHOP, network: "facebook" } })).toBe(0);
  });

  it("matches whole words and fills in first names", () => {
    expect(matchesWords("This is great", ["hi"])).toBe(false);
    expect(matchesWords("Hi there", ["hi"])).toBe(true);
    expect(matchesWords("thanks, that's all!", ["thanks, that's all"])).toBe(true);
    expect(matchesWords("anything", [])).toBe(true);
    expect(fillReply("Hi {name}!", "Ann Smith")).toBe("Hi Ann!");
    expect(fillReply("Hi {name}!", "@cara.lou")).toBe("Hi cara!");
    expect(fillReply("Hi {name}!", "Facebook user")).toBe("Hi there!");
  });
});

