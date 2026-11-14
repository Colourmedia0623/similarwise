import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import { isFreeShop } from "../waitlist.server";
import { NETWORK_NAME, PROVIDER, postLink, providerApproved, type Fetch, type Network, type TikTokChoices } from "./networks.server";
import { readStats, sendTo } from "./social.server";
import { fromZoned, validZone } from "./when";
import { CAMPAIGN_COLORS, LIMITS, MAX_PICTURES } from "./publishing";

// The social calendar: posts the merchant writes themselves (a picture and
// a caption, with a different caption per network if they like), sent to
// their connected Facebook Pages, Instagram and TikTok accounts now, at a
// set time, or kept as drafts, and grouped into campaigns. Due posts go out
// from the minute scheduler (sendDuePosts).


type Status = "draft" | "scheduled" | "sending" | "sent" | "partial" | "failed";

// TikTok stays behind SOCIAL_APPROVED until TikTok approves the app, apart
// from Colourmedia's own and free stores (the same rule as connecting).
export const networkOpen = (shop: string, n: Network) => providerApproved(PROVIDER[n]) || isFreeShop(shop);

const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

// Every picture of a post in order. Posts from before carousels only have imageId.
export const postImages = (p: { imageId: string | null; imageIds: string }) => {
  const ids = json<string[]>(p.imageIds, []);
  return ids.length ? ids : p.imageId ? [p.imageId] : [];
};

export const socialImageUrl = (id: string, forNetwork?: "instagram" | "tiktok") =>
  `${process.env.SHOPIFY_APP_URL || ""}/social-images/${id}.jpg${forNetwork ? `?for=${forNetwork}` : ""}`;

// Everything the calendar page shows: the shop's posts from the last four
// months on, every draft and failed post, the campaigns, and the blog
// articles shared from their own pages.
export async function calendarData(shop: string, now = new Date()) {
  const since = new Date(now.getTime() - 120 * 86400_000);
  const [accounts, posts, campaigns, shares, articles] = await Promise.all([
    db.socialAccount.findMany({
      where: { shop },
      orderBy: [{ network: "asc" }, { name: "asc" }],
    }),
    db.scheduledPost.findMany({
      where: {
        shop,
        OR: [{ scheduledAt: { gte: since } }, { scheduledAt: null }, { status: { in: ["draft", "failed", "partial"] } }],
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    }),
    db.socialCampaign.findMany({
      where: { shop },
      orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
    }),
    db.socialPost.findMany({
      where: { shop, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    }),
    db.blogArticle.findMany({
      where: { shop },
      select: { id: true, title: true },
    }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  // An account disconnected (or connected again) since the post went out.
  const gone = (network: string) => `${NETWORK_NAME[network as Network] ?? "Social"} account, no longer connected`;
  const results = (scheduleId: string) =>
    shares
      .filter((s) => s.scheduleId === scheduleId)
      .map((s) => ({
        id: s.id,
        network: s.network as Network,
        account: accountName.get(s.accountId) ?? gone(s.network),
        accountId: s.accountId,
        status: s.status,
        url: postLink(s),
        error: s.error,
        stats: readStats(s.stats),
      }));
  // Article shares made together count as one post on the calendar.
  const title = new Map(articles.map((a) => [a.id, a.title]));
  const shared = new Map<string, typeof shares>();
  for (const s of shares) {
    if (!s.articleId) continue;
    const key = `${s.articleId}:${Math.floor(s.createdAt.getTime() / 600_000)}`;
    shared.set(key, [...(shared.get(key) ?? []), s]);
  }
  return {
    accounts: accounts.filter((a) => networkOpen(shop, a.network as Network)).map((a) => ({ id: a.id, network: a.network as Network, name: a.name })),
    posts: posts.map((p) => ({
      id: p.id,
      caption: p.caption,
      captions: json<Partial<Record<Network, string>>>(p.captions, {}),
      accountIds: json<string[]>(p.accountIds, []),
      tiktok: json<Record<string, TikTokChoices>>(p.tiktok, {}),
      image: p.imageId ? `/social-images/${p.imageId}.jpg` : null,
      imageId: p.imageId,
      images: postImages(p).map((id) => ({ id, url: `/social-images/${id}.jpg` })),
      link: p.link,
      campaignId: p.campaignId,
      status: p.status as Status,
      at: p.scheduledAt?.toISOString() ?? null,
      sentAt: p.sentAt?.toISOString() ?? null,
      error: p.error,
      updatedAt: p.updatedAt.toISOString(),
      results: results(p.id),
    })),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      startDay: c.startDay,
      endDay: c.endDay,
      note: c.note,
      archived: c.archived,
    })),
    articleShares: [...shared.values()].map((group) => ({
      id: group[0].id,
      articleId: group[0].articleId!,
      title: title.get(group[0].articleId!) ?? "Blog article",
      caption: group[0].caption,
      at: group[0].createdAt.toISOString(),
      image: `/images/${group[0].articleId}.jpg`,
      results: group.map((s) => ({
        id: s.id,
        network: s.network as Network,
        account: accountName.get(s.accountId) ?? gone(s.network),
        status: s.status,
        url: postLink(s),
        error: s.error,
        stats: readStats(s.stats),
      })),
    })),
  };
}

export type PostInput = {
  id?: string;
  caption: string;
  captions: Partial<Record<Network, string>>;
  accountIds: string[];
  tiktok: Record<string, TikTokChoices>;
  link: string;
  campaignId: string;
  imageIds: string[];
  mode: "draft" | "schedule" | "now";
  day: string;
  time: string;
  tz: string;
};

export function readPostInput(form: FormData): PostInput {
  const text = (k: string) => String(form.get(k) ?? "");
  const mode = text("mode");
  return {
    id: text("id") || undefined,
    caption: text("caption"),
    captions: json(text("captions"), {}),
    accountIds: json(text("accountIds"), []),
    tiktok: json(text("tiktok"), {}),
    link: text("link").trim(),
    campaignId: text("campaignId"),
    imageIds: json<unknown[]>(text("imageIds"), []).filter((x): x is string => typeof x === "string" && !!x),
    mode: mode === "now" || mode === "schedule" ? mode : "draft",
    day: text("day"),
    time: text("time"),
    tz: text("tz"),
  };
}

const EDITABLE = ["draft", "scheduled", "failed"];

// Checks a post can go out as written: accounts, a caption within each
// network's limit, a picture where the network needs one, TikTok's choices.
async function problems(shop: string, input: PostInput, hasImage: boolean) {
  if (!input.accountIds.length) return "Pick at least one account to post to.";
  const accounts = await db.socialAccount.findMany({
    where: { shop, id: { in: input.accountIds } },
  });
  if (accounts.length !== input.accountIds.length) return "One of the accounts isn't connected any more. Pick them again.";
  for (const a of accounts) {
    const n = a.network as Network;
    if (!networkOpen(shop, n)) return `Posting to ${NETWORK_NAME[n]} isn't open yet.`;
    const caption = (input.captions[n] || input.caption).trim();
    if (!caption) return `Write a caption for ${NETWORK_NAME[n]}.`;
    if (caption.length > LIMITS[n]) return `The ${NETWORK_NAME[n]} caption is too long. Keep it under ${LIMITS[n].toLocaleString("en-GB")} characters.`;
    if (n === "instagram" && (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) return "Instagram allows up to 30 hashtags in a caption.";
    if (n !== "facebook" && !hasImage) return `${NETWORK_NAME[n]} needs a picture. Add one to the post.`;
    if (n === "tiktok" && !input.tiktok[a.id]?.privacy) return `Choose who can see the post on TikTok (${a.name}).`;
  }
  return null;
}

// Saves a post from the composer as a draft, scheduled for its time, or
// sends it now.
export async function savePost(shop: string, input: PostInput, { f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}) {
  const existing = input.id ? await db.scheduledPost.findFirst({ where: { id: input.id, shop } }) : null;
  if (input.id && !existing) return { error: "That post isn't there any more." };
  if (existing && !EDITABLE.includes(existing.status))
    return {
      error: "That post has already gone out, so it can't be changed. Duplicate it to post it again.",
    };
  if (input.link && !/^https?:\/\/\S+$/i.test(input.link)) return { error: "The link needs to start with https://." };
  if (input.caption.length > 63206) return { error: "That caption is too long." };
  const imageIds = [...new Set(input.imageIds)];
  if (imageIds.length > MAX_PICTURES) return { error: `A post can have up to ${MAX_PICTURES} pictures.` };
  const found = imageIds.length ? await db.socialImage.findMany({ where: { id: { in: imageIds }, shop }, select: { id: true } }) : [];
  if (found.length !== imageIds.length) return { error: "One of the pictures isn't there any more. Add it again." };
  const image = imageIds.length ? { id: imageIds[0] } : null;
  const campaign = input.campaignId
    ? await db.socialCampaign.findFirst({
        where: { id: input.campaignId, shop },
      })
    : null;
  let at: Date | null = null;
  if (input.day) {
    at = fromZoned(input.day, input.time || "09:00", validZone(input.tz));
    if (!at) return { error: "Choose a day and time for the post." };
  }
  if (input.mode === "schedule") {
    if (!at) return { error: "Choose a day and time for the post." };
    if (at.getTime() < now.getTime() + 60_000)
      return {
        error: "That time has passed. Choose a later time, or post it now.",
      };
  }
  if (input.mode !== "draft") {
    const problem = await problems(shop, input, !!image);
    if (problem) return { error: problem };
  } else if (!input.caption.trim() && !Object.values(input.captions).some((c) => c?.trim()) && !image) {
    return {
      error: "Write something or add a picture before saving the draft.",
    };
  }
  const captions = Object.fromEntries(Object.entries(input.captions).filter(([n, c]) => n in LIMITS && c?.trim()));
  const data = {
    caption: input.caption.trim(),
    captions: JSON.stringify(captions),
    accountIds: JSON.stringify(input.accountIds),
    tiktok: Object.keys(input.tiktok).length ? JSON.stringify(input.tiktok) : null,
    imageId: image?.id ?? null,
    imageIds: JSON.stringify(imageIds),
    link: input.link || null,
    campaignId: campaign?.id ?? null,
    status: input.mode === "draft" ? "draft" : input.mode === "now" ? "sending" : "scheduled",
    scheduledAt: input.mode === "now" ? now : at,
    error: null,
  };
  // A failed post written again starts afresh.
  if (existing?.status === "failed")
    await db.socialPost.deleteMany({
      where: { shop, scheduleId: existing.id },
    });
  const post = existing ? await db.scheduledPost.update({ where: { id: existing.id }, data }) : await db.scheduledPost.create({ data: { shop, ...data } });
  if (existing) for (const old of postImages(existing)) if (!imageIds.includes(old)) await dropImage(shop, old);
  if (input.mode === "now") return { id: post.id, ...(await sendPost(post.id, { f, now })) };
  return { id: post.id, status: post.status as Status };
}

// Sends a post to each of its accounts, or just the ones that failed last
// time. One failing doesn't stop the rest.
export async function sendPost(id: string, { f = fetch, now = new Date(), onlyFailed = false }: { f?: Fetch; now?: Date; onlyFailed?: boolean } = {}) {
  const post = await db.scheduledPost.findUnique({ where: { id } });
  if (!post) return { error: "That post isn't there any more." };
  const ids = json<string[]>(post.accountIds, []);
  const captions = json<Partial<Record<Network, string>>>(post.captions, {});
  const choices = json<Record<string, TikTokChoices>>(post.tiktok, {});
  const earlier = onlyFailed ? await db.socialPost.findMany({ where: { scheduleId: id } }) : [];
  const done = new Set(earlier.filter((r) => r.status !== "failed").map((r) => r.accountId));
  if (onlyFailed)
    await db.socialPost.deleteMany({
      where: { scheduleId: id, status: "failed" },
    });
  const accounts = await db.socialAccount.findMany({
    where: { shop: post.shop, id: { in: ids } },
  });
  const results = await Promise.all(
    ids
      .filter((accountId) => !done.has(accountId))
      .map(async (accountId) => {
        const account = accounts.find((a) => a.id === accountId);
        const network = (account?.network ?? "facebook") as Network;
        const caption = (captions[network] || post.caption).trim();
        const record = (data: { status: string; remoteId?: string; url?: string | null; error?: string }) =>
          db.socialPost.create({
            data: {
              shop: post.shop,
              scheduleId: id,
              accountId,
              accountRef: account?.accountId,
              network,
              caption,
              ...data,
              error: data.error?.slice(0, 300),
            },
          });
        if (!account) {
          await record({
            status: "failed",
            error: "That account isn't connected any more.",
          });
          return false;
        }
        try {
          const images = postImages(post).map((img) => socialImageUrl(img, network === "instagram" || network === "tiktok" ? network : undefined));
          const sent = await sendTo(
            account,
            {
              caption,
              title: caption.split("\n")[0].slice(0, 90),
              link: post.link ?? "",
              imageUrl: images[0] ?? "",
              images,
            },
            choices[account.id],
            f,
            now,
          );
          await record({
            status: sent.processing ? "processing" : "posted",
            remoteId: sent.remoteId,
            url: sent.url,
          });
          return true;
        } catch (err) {
          console.error("Couldn't send a calendar post", post.shop, network, err);
          await record({
            status: "failed",
            error: `${NETWORK_NAME[network]} said: ${err instanceof Error ? err.message : String(err)}`,
          });
          return false;
        }
      }),
  );
  const failed = results.filter((ok) => !ok).length;
  const went = results.length - failed + done.size;
  const status: Status = failed === 0 ? "sent" : went === 0 ? "failed" : "partial";
  await db.scheduledPost.update({
    where: { id },
    data: {
      status,
      sentAt: went ? now : post.sentAt,
      error: failed ? `${failed === 1 ? "1 account" : `${failed} accounts`} didn't take the post.` : null,
    },
  });
  return { status, posted: went, failed };
}

// Every scheduled post whose time has come, sent once: each is claimed
// before sending so two runs can't both send it. A post left sending by a
// crash is marked failed after half an hour, to be retried by hand.
let sending = false;
export async function sendDuePosts({ f = fetch, now = new Date() }: { f?: Fetch; now?: Date } = {}) {
  if (sending) return 0;
  sending = true;
  try {
    await db.scheduledPost.updateMany({
      where: {
        status: "sending",
        updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) },
      },
      data: {
        status: "failed",
        error: "It didn't finish sending. Check the networks, then retry.",
      },
    });
    const due = await db.scheduledPost.findMany({
      where: { status: "scheduled", scheduledAt: { lte: now } },
      orderBy: { scheduledAt: "asc" },
      take: 50,
    });
    let sent = 0;
    for (const p of due) {
      const claimed = await db.scheduledPost.updateMany({
        where: { id: p.id, status: "scheduled" },
        data: { status: "sending" },
      });
      if (!claimed.count) continue;
      await sendPost(p.id, { f, now }).catch(async (err) => {
        console.error("Couldn't send a scheduled post", p.id, err);
        await db.scheduledPost.update({
          where: { id: p.id },
          data: {
            status: "failed",
            error: "Something went wrong sending it. Retry.",
          },
        });
      });
      sent++;
    }
    return sent;
  } finally {
    sending = false;
  }
}

export async function retryPost(shop: string, id: string, opts: { f?: Fetch; now?: Date } = {}) {
  const post = await db.scheduledPost.findFirst({ where: { id, shop } });
  if (!post || !["failed", "partial"].includes(post.status)) return { error: "There's nothing to retry on that post." };
  await db.scheduledPost.update({ where: { id }, data: { status: "sending" } });
  return sendPost(id, { ...opts, onlyFailed: true });
}

// Moves a draft or scheduled post to another day, keeping its time.
export async function movePost(shop: string, id: string, day: string, time: string, tz: string, now = new Date()) {
  const post = await db.scheduledPost.findFirst({ where: { id, shop } });
  if (!post || !["draft", "scheduled"].includes(post.status)) return { error: "Only drafts and scheduled posts can be moved." };
  const at = fromZoned(day, time, validZone(tz));
  if (!at) return { error: "Choose a day for the post." };
  if (post.status === "scheduled" && at.getTime() < now.getTime() + 60_000) return { error: "That time has passed. Move it to a later day." };
  await db.scheduledPost.update({ where: { id }, data: { scheduledAt: at } });
  return { ok: true as const };
}

export async function duplicatePost(shop: string, id: string) {
  const p = await db.scheduledPost.findFirst({ where: { id, shop } });
  if (!p) return { error: "That post isn't there any more." };
  const imageIds: string[] = [];
  for (const id of postImages(p)) {
    const img = await db.socialImage.findFirst({ where: { id, shop } });
    if (img) imageIds.push((await db.socialImage.create({ data: { shop, data: img.data, mime: img.mime, width: img.width, height: img.height } })).id);
  }
  const copy = await db.scheduledPost.create({
    data: {
      shop,
      caption: p.caption,
      captions: p.captions,
      accountIds: p.accountIds,
      tiktok: null,
      imageId: imageIds[0] ?? null,
      imageIds: JSON.stringify(imageIds),
      link: p.link,
      campaignId: p.campaignId,
      status: "draft",
      scheduledAt: null,
    },
  });
  return { id: copy.id };
}

// Takes the post off the calendar. One that went out stays on the networks.
export async function deleteSocialPost(shop: string, id: string) {
  const p = await db.scheduledPost.findFirst({ where: { id, shop } });
  if (!p) return { ok: true as const };
  if (p.status === "sending")
    return {
      error: "That post is being sent right now. Try again in a minute.",
    };
  await db.scheduledPost.delete({ where: { id } });
  await db.socialPost.deleteMany({ where: { shop, scheduleId: id } });
  for (const img of postImages(p)) await dropImage(shop, img);
  return { ok: true as const };
}

async function dropImage(shop: string, imageId: string) {
  const using = await db.scheduledPost.count({ where: { shop, OR: [{ imageId }, { imageIds: { contains: `"${imageId}"` } }] } });
  if (!using) await db.socialImage.deleteMany({ where: { id: imageId, shop } });
}

const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 2048;

// A picture for a post, stored as a JPEG no bigger than 2048 pixels a side,
// which every network takes.
export async function uploadSocialImage(shop: string, file: { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }) {
  if (!UPLOAD_TYPES.includes(file.type)) return { error: "Choose a JPG, PNG or WebP picture." };
  if (file.size > 15_000_000) return { error: "Choose a picture under 15 MB." };
  const { default: sharp } = await import("sharp");
  try {
    const { data, info } = await sharp(new Uint8Array(await file.arrayBuffer()))
      .rotate()
      .resize({
        width: MAX_SIDE,
        height: MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    const image = await db.socialImage.create({
      data: {
        shop,
        data: new Uint8Array(data),
        mime: "image/jpeg",
        width: info.width,
        height: info.height,
      },
    });
    return {
      imageId: image.id,
      url: `/social-images/${image.id}.jpg`,
      width: info.width,
      height: info.height,
    };
  } catch (err) {
    console.error("Couldn't read an uploaded picture", shop, err);
    return { error: "Couldn't read that picture. Try another one." };
  }
}

// Instagram only takes pictures between 4:5 (tall) and 1.91:1 (wide), so a
// picture outside that gets white space added for Instagram's copy.
export async function instagramCopy(data: Uint8Array, width: number, height: number) {
  const ratio = width / height;
  if (ratio >= 0.8 && ratio <= 1.91) return data;
  const { default: sharp } = await import("sharp");
  const [w, h] = ratio < 0.8 ? [Math.ceil(height * 0.8), height] : [width, Math.ceil(width / 1.91)];
  return new Uint8Array(await sharp(data).resize({ width: w, height: h, fit: "contain", background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer());
}

export async function socialImage(id: string) {
  return db.socialImage.findUnique({ where: { id } });
}

export async function saveCampaign(
  shop: string,
  input: {
    id?: string;
    name: string;
    color: string;
    startDay: string;
    endDay: string;
    note: string;
  },
) {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { error: "Give the campaign a name." };
  const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const [startDay, endDay] = [day(input.startDay), day(input.endDay)];
  if (startDay && endDay && endDay < startDay) return { error: "The campaign ends before it starts." };
  const color = CAMPAIGN_COLORS.includes(input.color) ? input.color : CAMPAIGN_COLORS[0];
  const data = {
    name,
    color,
    startDay,
    endDay,
    note: input.note.trim().slice(0, 300) || null,
  };
  if (input.id) {
    const c = await db.socialCampaign.updateMany({
      where: { id: input.id, shop },
      data,
    });
    return c.count ? { id: input.id } : { error: "That campaign isn't there any more." };
  }
  return {
    id: (await db.socialCampaign.create({ data: { shop, ...data } })).id,
  };
}

export async function archiveCampaign(shop: string, id: string, archived: boolean) {
  await db.socialCampaign.updateMany({
    where: { id, shop },
    data: { archived },
  });
  return { ok: true as const };
}

// The campaign goes; its posts stay, without it.
export async function deleteCampaign(shop: string, id: string) {
  await db.scheduledPost.updateMany({
    where: { shop, campaignId: id },
    data: { campaignId: null },
  });
  await db.socialCampaign.deleteMany({ where: { id, shop } });
  return { ok: true as const };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption", "facebook", "instagram", "tiktok", "pinterest"],
  properties: {
    caption: { type: "string" },
    facebook: { type: "string" },
    instagram: { type: "string" },
    tiktok: { type: "string" },
    pinterest: { type: "string" },
  },
};

const SYSTEM = `You write social media posts for a small online shop. You get the shop's notes on what the post is about, and maybe a draft to improve. Write in the shop's market spelling, friendly and plain, no hype, and never invent offers, prices, dates or facts that aren't in the notes.
- caption: one post that works on any network, 1 to 3 short sentences and up to 3 hashtags.
- facebook: 1 to 3 short sentences that make people want to click or visit. At most 2 hashtags. Any link is added separately, so don't include one.
- instagram: 2 to 4 short lines with a line break between them, then 5 to 8 relevant hashtags on the last line. Say "link in bio" if there's somewhere to go.
- tiktok: a short, punchy caption under 300 characters ending with 3 to 5 hashtags.
- pinterest: a pin description of 1 to 3 sentences, under 500 characters, using the words people would search for, with 2 to 4 hashtags at the end.
No emojis unless they add something; at most two per post.`;

// Captions from a short brief, for the composer's Write with AI button.
export async function writeSocialCaptions(shop: string, brief: string, draft: string, ask: AskJson | null = claudeJson()) {
  if (!ask) return { error: "Writing with AI isn't switched on for this app yet." };
  if (!brief.trim() && !draft.trim()) return { error: "Say what the post is about first." };
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  try {
    const out = (await ask(
      SYSTEM,
      {
        shop,
        market: settings?.market ?? null,
        about: brief.slice(0, 1000),
        draft: draft.slice(0, 2000),
      },
      SCHEMA,
    )) as Record<string, unknown> | null;
    const text = (k: string, max: number) => (typeof out?.[k] === "string" ? (out[k] as string).trim().slice(0, max) : "");
    const captions = {
      caption: text("caption", 2200),
      facebook: text("facebook", 2200),
      instagram: text("instagram", 2200),
      tiktok: text("tiktok", 2200),
      pinterest: text("pinterest", 800),
    };
    if (!captions.caption) return { error: "Couldn't write captions just now. Try again." };
    return { captions };
  } catch (err) {
    console.error("Couldn't write social captions", shop, err);
    return { error: "Couldn't write captions just now. Try again." };
  }
}

// A scheduled post sent straight away instead of waiting for its time.
export async function sendNow(shop: string, id: string, opts: { f?: Fetch; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const claimed = await db.scheduledPost.updateMany({
    where: { id, shop, status: "scheduled" },
    data: { status: "sending", scheduledAt: now },
  });
  if (!claimed.count) return { error: "That post isn't waiting to go out any more." };
  return sendPost(id, { ...opts, now });
}

// The content calendar's blog articles, shown alongside the social posts.
export async function blogPlan(shop: string, since: string) {
  const rows = await db.plannedPost.findMany({
    where: { shop, day: { gte: since } },
    orderBy: { day: "asc" },
    select: { id: true, day: true, title: true, status: true, articleId: true },
  });
  return rows;
}
