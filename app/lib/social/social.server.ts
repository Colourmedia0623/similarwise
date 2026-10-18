import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import { articlePicture, atOrigin } from "../ideas/articles.server";
import { imageUrl } from "../ideas/images.server";
import {
  NETWORK_NAME,
  postFacebook,
  postInstagram,
  postTikTok,
  refreshTikTok,
  tiktokCreator,
  tiktokStatus,
  type Connected,
  type Fetch,
  type Network,
  type Post,
  type Posted,
  type TikTokChoices,
} from "./networks.server";
import { seal, unseal } from "./seal.server";

// Sharing blog articles to the merchant's Facebook Pages, Instagram business
// accounts and TikTok: a caption for each network written by Claude, the
// article's picture, and a link back to the post on the shop's blog.

export async function saveAccounts(shop: string, accounts: Connected[]) {
  for (const a of accounts) {
    const data = { name: a.name.slice(0, 200), token: seal(a.token), refreshToken: a.refreshToken ? seal(a.refreshToken) : null, tokenExpiresAt: a.expiresAt ?? null };
    await db.socialAccount.upsert({ where: { shop_network_accountId: { shop, network: a.network, accountId: a.accountId } }, update: data, create: { shop, network: a.network, accountId: a.accountId, ...data } });
  }
  return accounts.length;
}

export async function socialAccounts(shop: string) {
  const rows = await db.socialAccount.findMany({ where: { shop }, orderBy: [{ network: "asc" }, { name: "asc" }] });
  return rows.map((r) => ({ id: r.id, network: r.network as Network, name: r.name }));
}

export async function disconnectAccount(shop: string, id: string) {
  await db.socialAccount.deleteMany({ where: { id, shop } });
}

export async function setSocialAuto(shop: string, on: boolean) {
  await db.shopSettings.upsert({ where: { shop }, update: { socialAuto: on }, create: { shop, socialAuto: on } });
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facebook", "instagram", "tiktok"],
  properties: { facebook: { type: "string" }, instagram: { type: "string" }, tiktok: { type: "string" } },
};

const SYSTEM = `You write social media posts for a small online shop, sharing a new article from its blog. You get the article's title, summary and the search it's written for. Write one post per network, in the shop's market spelling, friendly and plain, no hype, no made-up offers or facts beyond the article:
- facebook: 1 to 3 short sentences that make people want to read the article. The link is added separately, so don't include it. At most 2 hashtags.
- instagram: a caption of 2 to 4 short lines with a line break between them, ending with "Read the full guide on our blog, link in bio." and then 5 to 8 relevant hashtags on the last line.
- tiktok: a short, punchy caption under 300 characters ending with 3 to 5 hashtags.
No emojis unless they add something; at most two per post.`;

export type Captions = Record<Network, string>;

export async function writeCaptions(shop: string, articleId: string, ask: AskJson | null = claudeJson()): Promise<Captions | { error: string }> {
  if (!ask) return { error: "Captions aren't switched on for this app yet." };
  const a = await db.blogArticle.findFirst({ where: { id: articleId, shop } });
  if (!a) return { error: "That article isn't there any more." };
  const out = (await ask(SYSTEM, { title: a.title, summary: a.summary, search: a.keyword }, SCHEMA)) as Partial<Record<Network, unknown>> | null;
  const text = (k: Network, max: number) => (typeof out?.[k] === "string" ? (out[k] as string).trim().slice(0, max) : "");
  const captions = { facebook: text("facebook", 2000), instagram: text("instagram", 2200), tiktok: text("tiktok", 2000) };
  if (!captions.facebook && !captions.instagram && !captions.tiktok) return { error: "Couldn't write the captions. Try again." };
  return captions;
}

// A fresh TikTok token when the old one has run out (they last a day).
async function liveToken(account: { id: string; network: string; token: string; refreshToken: string | null; tokenExpiresAt: Date | null }, f: Fetch, now: Date) {
  if (account.network !== "tiktok" || !account.tokenExpiresAt || account.tokenExpiresAt.getTime() > now.getTime() + 60_000) return unseal(account.token);
  if (!account.refreshToken) throw new Error("Connect TikTok again.");
  const t = await refreshTikTok(unseal(account.refreshToken), f, now);
  await db.socialAccount.update({
    where: { id: account.id },
    data: { token: seal(t.token), tokenExpiresAt: t.expiresAt, ...(t.refreshToken ? { refreshToken: seal(t.refreshToken) } : {}) },
  });
  return t.token;
}

// The TikTok account a post would go to, read fresh each time the merchant
// shares, as TikTok's rules ask.
export async function tiktokAccount(shop: string, accountId: string, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}) {
  const account = await db.socialAccount.findFirst({ where: { id: accountId, shop, network: "tiktok" } });
  if (!account) return { error: "That TikTok account isn't connected any more." };
  try {
    return { creator: await tiktokCreator(await liveToken(account, f, now), f) };
  } catch (err) {
    return { error: `TikTok said: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export type Pick = { accountId: string; caption: string; tiktok?: TikTokChoices };

// Posts the article to each picked account. One failing doesn't stop the rest.
export async function shareArticle(shop: string, articleId: string, picks: Pick[], { f = fetch, origin = null, now = new Date() }: { f?: Fetch; origin?: string | null; now?: Date } = {}) {
  const a = await db.blogArticle.findFirst({ where: { id: articleId, shop } });
  if (!a) return { error: "That article isn't there any more." };
  const link = atOrigin(a.url, origin);
  if (a.status !== "published" || !link) return { error: "Publish the article on your blog first, so the posts can link to it." };
  if (!picks.length) return { error: "Pick at least one account." };
  const picture = await articlePicture(shop, a);
  // Served from the app's own address, which TikTok needs to have verified.
  const image = picture ? `${imageUrl(a.id)}${picture.made ? picture.url.slice(picture.url.indexOf("?")) : ""}` : null;
  const accounts = await db.socialAccount.findMany({ where: { shop, id: { in: picks.map((p) => p.accountId) } } });
  const results = await Promise.all(
    picks.map(async (pick) => {
      const account = accounts.find((x) => x.id === pick.accountId);
      if (!account) return { accountId: pick.accountId, error: "That account isn't connected any more." };
      const network = account.network as Network;
      const caption = pick.caption.trim();
      const fail = async (error: string) => {
        await db.socialPost.create({ data: { shop, articleId, accountId: account.id, network, caption, status: "failed", error: error.slice(0, 300) } });
        return { accountId: account.id, error };
      };
      if (!caption) return fail(`Write a caption for ${NETWORK_NAME[network]}.`);
      if (network === "tiktok" && !pick.tiktok?.privacy) return fail("Choose who can see the TikTok post.");
      if (network !== "facebook" && !image) return fail(`${NETWORK_NAME[network]} needs a picture. Make or upload one for the article first.`);
      try {
        const token = await liveToken(account, f, now);
        const post: Post = { caption, title: a.title, link, imageUrl: image ?? "" };
        const done: Posted =
          network === "facebook" ? await postFacebook(account.accountId, token, post, f) : network === "instagram" ? await postInstagram(account.accountId, token, post, f) : await postTikTok(token, post, pick.tiktok!, f);
        await db.socialPost.create({ data: { shop, articleId, accountId: account.id, network, caption, status: done.processing ? "processing" : "posted", remoteId: done.remoteId, url: done.url } });
        return { accountId: account.id, ok: true as const };
      } catch (err) {
        console.error("Couldn't post to social", shop, network, err);
        return fail(`${NETWORK_NAME[network]} said: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  const failed = results.filter((r) => "error" in r).length;
  return failed === results.length ? { error: results.map((r) => ("error" in r ? r.error : "")).join(" ") } : { posted: results.length - failed, failed };
}

// After the content calendar publishes an article: shares it to the
// connected Facebook Pages and Instagram accounts, when the merchant has
// asked for that. TikTok is left out: it only allows posts the merchant
// has checked and sent themselves.
export async function autoShare(shop: string, articleId: string, opts: { ask?: AskJson | null; f?: Fetch; now?: Date } = {}) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.socialAuto) return;
  const accounts = await db.socialAccount.findMany({ where: { shop, network: { not: "tiktok" } } });
  if (!accounts.length) return;
  if (await db.socialPost.count({ where: { shop, articleId } })) return;
  const captions = await writeCaptions(shop, articleId, opts.ask === undefined ? claudeJson() : opts.ask);
  if ("error" in captions) return;
  await shareArticle(
    shop,
    articleId,
    accounts.map((x) => ({ accountId: x.id, caption: captions[x.network as Network] })),
    { f: opts.f, now: opts.now },
  );
}

// Asks TikTok where the article's sent posts got to, and records the answer.
// One that can't be checked stays as sent, to try again next time.
export async function checkTikTokPosts(shop: string, articleId: string, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}) {
  const posts = await db.socialPost.findMany({ where: { shop, articleId, network: "tiktok", status: "processing", remoteId: { not: null } } });
  for (const p of posts) {
    const account = await db.socialAccount.findFirst({ where: { id: p.accountId, shop } });
    if (!account) continue;
    try {
      const token = await liveToken(account, f, now);
      const done = await tiktokStatus(token, p.remoteId!, f);
      if (done.status === "posted") await db.socialPost.update({ where: { id: p.id }, data: { status: "posted" } });
      if (done.status === "failed") await db.socialPost.update({ where: { id: p.id }, data: { status: "failed", error: done.error.slice(0, 300) } });
    } catch (err) {
      console.error("Couldn't check a TikTok post", shop, p.id, err);
    }
  }
}

export async function articleShares(shop: string, articleId: string) {
  const [posts, accounts] = await Promise.all([
    db.socialPost.findMany({ where: { shop, articleId }, orderBy: { createdAt: "desc" } }),
    db.socialAccount.findMany({ where: { shop }, select: { id: true, name: true } }),
  ]);
  const name = new Map(accounts.map((x) => [x.id, x.name]));
  return posts.map((p) => ({
    id: p.id,
    network: p.network as Network,
    account: name.get(p.accountId) ?? "Disconnected account",
    status: p.status,
    url: p.url,
    error: p.error,
    createdAt: p.createdAt.toISOString(),
  }));
}
