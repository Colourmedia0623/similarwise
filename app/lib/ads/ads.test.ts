import { beforeEach, describe, expect, it } from "vitest";
import db from "../../db.server";
import { adsOverview, findMetaPage, metaQuery, pickMetaPage, refreshAds, setMetaPage, setTiktokAdvertiser } from "./ads.server";
import { parseGoogleAds, parseMetaAds, parseMetaPages, parseTiktokAds, toDate, type AdsClient, type LibraryAd, type MetaPage } from "./scrapecreators.server";

const SHOP = "mine.myshopify.com";
const NOW = new Date("2026-10-17T12:00:00Z");

describe("ad library responses", () => {
  it("reads Meta pages and ads", () => {
    expect(
      parseMetaPages({
        success: true,
        searchResults: [
          { page_id: "1", name: "Rival Boxes", likes: 5000, page_alias: "rivalboxes", ig_username: "rival" },
          { page_id: "2", name: "Gone", page_is_deleted: true },
        ],
      }),
    ).toEqual([{ id: "1", name: "Rival Boxes", likes: 5000, alias: "rivalboxes", instagram: "rival" }]);

    const page = parseMetaAds({
      success: true,
      cursor: null,
      results: [
        {
          ad_archive_id: "111",
          page_name: "Rival Boxes",
          is_active: true,
          start_date: 1760000000,
          publisher_platform: ["FACEBOOK", "INSTAGRAM"],
          snapshot: {
            body: { text: "Gift boxes for every occasion" },
            title: "Shop now",
            cta_text: "Shop Now",
            link_url: "https://rival.com/boxes",
            display_format: "IMAGE",
            images: [{ original_image_url: "https://img/1.jpg" }],
          },
        },
        {
          ad_archive_id: "222",
          snapshot: { body: { text: "{{product.brand}}" }, cards: [{ title: "Kraft box", body: "From £3", resized_image_url: "https://img/2.jpg" }] },
        },
      ],
    });
    expect(page.complete).toBe(true);
    expect(page.ads[0]).toMatchObject({
      adId: "111",
      advertiser: "Rival Boxes",
      title: "Shop now",
      text: "Gift boxes for every occasion",
      imageUrl: "https://img/1.jpg",
      adUrl: "https://www.facebook.com/ads/library/?id=111",
      placements: ["FACEBOOK", "INSTAGRAM"],
      startedAt: new Date(1760000000 * 1000),
      active: true,
    });
    // Catalogue placeholders give way to the first card.
    expect(page.ads[1]).toMatchObject({ title: "Kraft box", text: "From £3", imageUrl: "https://img/2.jpg" });
  });

  it("reads TikTok and Google ads, judging running from when they were last shown", () => {
    const tiktok = parseTiktokAds(
      {
        success: true,
        resolved_advertiser_name: "Rival Ltd",
        advertiser_matches: [{ name: "Rival Ltd" }, { name: "Rival Toys" }],
        has_more: true,
        ads: [
          { id: "t1", name: "Rival Ltd", url: "https://library.tiktok.com/ads/detail/?ad_id=t1", first_shown_date: "2026-10-01", last_shown_date: "2026-10-16", videos: [{ video_url: "https://v/1.mp4", cover_img: "https://c/1.jpg" }] },
          { id: "t2", name: "Rival Ltd", last_shown_date: "2026-08-01" },
        ],
      },
      NOW,
    );
    expect(tiktok).toMatchObject({ resolved: "Rival Ltd", matches: ["Rival Ltd", "Rival Toys"], complete: false });
    expect(tiktok.ads.map((a) => [a.adId, a.active, a.imageUrl])).toEqual([
      ["t1", true, "https://c/1.jpg"],
      ["t2", false, null],
    ]);

    const google = parseGoogleAds(
      { success: true, number_of_ads_estimate: 40, ads: [{ advertiserId: "AR1", creativeId: "CR1", format: "image", imageUrl: "https://g/1.png", firstShown: "2026-09-01", lastShown: "2026-10-16" }] },
      NOW,
    );
    expect(google.estimate).toBe(40);
    expect(google.ads[0]).toMatchObject({ adId: "CR1", format: "IMAGE", adUrl: "https://adstransparency.google.com/advertiser/AR1/creative/CR1", active: true });
  });

  it("reads dates in seconds, milliseconds or text, and raises errors", () => {
    expect(toDate(1760000000)?.getTime()).toBe(1760000000000);
    expect(toDate(1760000000000)?.getTime()).toBe(1760000000000);
    expect(toDate("2026-10-01")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(toDate("nope")).toBeNull();
    expect(() => parseMetaAds({ success: false, message: "Out of credits" })).toThrow("Scrape Creators: Out of credits");
  });

  it("picks the competitor's own Facebook page", () => {
    const pages: MetaPage[] = [
      { id: "1", name: "Rival Fan Club", likes: 90000, alias: null, instagram: null },
      { id: "2", name: "Rival Boxes", likes: 4000, alias: "rivalboxes", instagram: null },
      { id: "3", name: "Something else", likes: 1, alias: null, instagram: null },
    ];
    expect(pickMetaPage("Rival Boxes", "rivalboxes.co.uk", pages)?.id).toBe("2");
    expect(pickMetaPage("rivalboxes.co.uk", "rivalboxes.co.uk", pages)?.id).toBe("2");
    expect(pickMetaPage("Nothing Alike", "unrelated.com", pages)).toBeNull();
  });
});

const ad = (platform: LibraryAd["platform"], adId: string, o: Partial<LibraryAd> = {}): LibraryAd => ({
  platform,
  adId,
  advertiser: "Rival",
  title: `Ad ${adId}`,
  text: null,
  imageUrl: null,
  videoUrl: null,
  linkUrl: null,
  adUrl: null,
  cta: null,
  placements: [],
  format: null,
  startedAt: null,
  lastShownAt: null,
  active: true,
  ...o,
});

function fakeClient() {
  const state = {
    calls: [] as string[],
    meta: [ad("meta", "m1")],
    tiktok: [ad("tiktok", "t1"), ad("tiktok", "x1", { advertiser: "Someone Else" })],
    google: [ad("google", "g1")],
    pages: [{ id: "p1", name: "Rival", likes: 100, alias: null, instagram: null }] as MetaPage[],
  };
  const client: AdsClient = {
    async metaPages(q) {
      state.calls.push(`pages:${q}`);
      return state.pages;
    },
    async metaAds(pageId, country) {
      state.calls.push(`meta:${pageId}@${country}`);
      return { ads: state.meta, complete: true };
    },
    async tiktokAds(name) {
      state.calls.push(`tiktok:${name}`);
      return { resolved: "Rival", matches: ["Rival", "Rival Toys"], ads: state.tiktok, complete: true };
    },
    async googleAds(domain, region) {
      state.calls.push(`google:${domain}@${region}`);
      return { estimate: state.google.length, ads: state.google, complete: true };
    },
  };
  return { state, client };
}

describe("refreshing ads", () => {
  beforeEach(async () => {
    await db.competitor.deleteMany();
    await db.shopSettings.deleteMany();
  });

  const competitor = () => db.competitor.create({ data: { shop: SHOP, name: "Rival", url: "https://www.rival.com" } });

  it("finds the accounts, stores ads, and reports new ones after the first run", async () => {
    await db.shopSettings.create({ data: { shop: SHOP, market: "GB" } });
    const c = await competitor();
    const { state, client } = fakeClient();
    await refreshAds(c.id, { client, now: NOW });
    expect(state.calls).toEqual(["pages:Rival", "meta:p1@GB", "tiktok:Rival", "google:rival.com@GB"]);
    let row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ metaPageId: "p1", metaPageName: "Rival", tiktokAdvertiser: "Rival", adsError: null });
    // Only the advertiser's own TikTok ads.
    expect((await db.competitorAd.findMany({ where: { competitorId: c.id } })).map((a) => a.adId).sort()).toEqual(["g1", "m1", "t1"]);
    expect(await db.competitorEvent.count()).toBe(0); // No "new ads" for what was already running.

    // A week on: one Meta ad stopped, two started.
    state.meta = [ad("meta", "m2"), ad("meta", "m3")];
    state.calls = [];
    await refreshAds(c.id, { client, now: new Date("2026-10-18T12:00:00Z") });
    expect(state.calls).toEqual([]); // Still fresh.
    await refreshAds(c.id, { client, now: new Date("2026-10-25T12:00:00Z") });
    expect(state.calls).not.toContain("pages:Rival"); // The page is remembered.
    const events = await db.competitorEvent.findMany();
    expect(events.map((e) => e.message)).toEqual(["Started 2 new Meta ads"]);
    expect((await db.competitorAd.findFirstOrThrow({ where: { adId: "m1" } })).active).toBe(false);

    const overview = await adsOverview(SHOP);
    expect(overview.competitors[0].counts).toEqual({ meta: 2, tiktok: 1, google: 1 });
    expect((await adsOverview(SHOP, { platform: "google" })).ads.map((a) => a.platform)).toEqual(["google"]);
    row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.adsMarket).toBe("GB");
  });

  it("tries the brand in the domain when the shop name finds no page", async () => {
    const c = await db.competitor.create({ data: { shop: SHOP, name: "Wholesale Gift Boxes", url: "https://www.tinyboxcompany.co.uk" } });
    const { state, client } = fakeClient();
    client.metaPages = async (q) => {
      state.calls.push(`pages:${q}`);
      return q === "tinyboxcompany" ? [{ id: "tb", name: "Tiny Box Company", likes: 11000, alias: "tinyboxcompany", instagram: null }] : [];
    };
    await refreshAds(c.id, { client, now: NOW });
    expect(state.calls.slice(0, 4)).toEqual(["pages:Wholesale Gift Boxes", "pages:tinyboxcompany", "meta:tb@US", "tiktok:Tiny Box Company"]);
    expect(await db.competitor.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ metaPageId: "tb", metaPageName: "Tiny Box Company" });
  });

  it("finds a page from the link the merchant pastes", async () => {
    expect(metaQuery("https://www.facebook.com/tinyboxcompany/")).toEqual({ query: "tinyboxcompany", slug: "tinyboxcompany" });
    expect(metaQuery("Tiny Box Company")).toEqual({ query: "Tiny Box Company", slug: null });
    const c = await competitor();
    const { state, client } = fakeClient();
    await refreshAds(c.id, { client, now: NOW });
    state.pages = [
      { id: "z", name: "Tiny Boxes Ltd", likes: 99999, alias: "tinyboxes", instagram: null },
      { id: "tb", name: "Tiny Box Company", likes: 11000, alias: "tinyboxcompany", instagram: null },
    ];
    expect((await findMetaPage(SHOP, c.id, "facebook.com/tinyboxcompany", client))?.id).toBe("tb");
    expect(state.calls).toContain("meta:tb@US");
    expect((await db.competitor.findUniqueOrThrow({ where: { id: c.id } })).metaPageId).toBe("tb");
    state.pages = [];
    expect(await findMetaPage(SHOP, c.id, "facebook.com/nobody", client)).toBeNull();
    expect(await findMetaPage("thief.myshopify.com", c.id, "facebook.com/tinyboxcompany", client)).toBeNull();
  });

  it("lets the merchant correct the accounts", async () => {
    const c = await competitor();
    const { state, client } = fakeClient();
    state.pages = [
      { id: "p1", name: "Rival", likes: 100, alias: null, instagram: null },
      { id: "p2", name: "Rival UK", likes: 50, alias: null, instagram: null },
    ];
    await refreshAds(c.id, { client, now: NOW });
    expect(await setMetaPage(SHOP, c.id, "p2", client)).toBe(true);
    expect(state.calls).toContain("meta:p2@US");
    expect(await setMetaPage(SHOP, c.id, "not-a-candidate", client)).toBe(false);
    expect(await setMetaPage("thief.myshopify.com", c.id, "p1", client)).toBe(false);

    // "None of these": no page, and no searching again.
    await setMetaPage(SHOP, c.id, null, client);
    state.calls = [];
    await refreshAds(c.id, { client, force: true });
    expect(state.calls.some((x) => x.startsWith("pages:") || x.startsWith("meta:"))).toBe(false);

    await setTiktokAdvertiser(SHOP, c.id, "Rival Toys", client);
    expect(state.calls).toContain("tiktok:Rival Toys");
    expect(await db.competitorAd.count({ where: { competitorId: c.id, platform: "tiktok" } })).toBe(0); // Rival's ads aren't Rival Toys'.
  });

  it("keeps going when one platform fails", async () => {
    const c = await competitor();
    const { client } = fakeClient();
    await refreshAds(c.id, {
      client: {
        ...client,
        async tiktokAds() {
          throw new Error("Scrape Creators answered 500");
        },
      },
      now: NOW,
    });
    const row = await db.competitor.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.adsError).toBe("TikTok: Scrape Creators answered 500");
    expect(row.adsAt).toEqual(NOW);
    expect(await db.competitorAd.count({ where: { competitorId: c.id } })).toBe(2);
  });

  it("does nothing when ad data isn't set up", async () => {
    const c = await competitor();
    await refreshAds(c.id, { client: null });
    expect((await db.competitor.findUniqueOrThrow({ where: { id: c.id } })).adsAt).toBeNull();
  });
});
