import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import type { Graphql } from "../prices/prices.server";
import { uploadSocialImage } from "../social/publishing.server";
import { isWebShop } from "../web/shop";
import { LIMITS } from "./products";
import {
  descriptionHtml,
  emptyCompliance,
  MAX_PHOTOS,
  type Category,
  type Compliance,
  type Listing,
} from "./listing";

// Product from photos: the merchant uploads a few photos of a product, its
// label and its packaging, Claude writes the whole listing from them, the
// merchant checks it and SimilarWise creates it in Shopify as a draft.

type Upload = {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

// Keeps the photos, a JPEG each, served at /social-images/<id>.jpg so Shopify
// can fetch them for the product.
export async function savePhotos(shop: string, files: Upload[]) {
  const photos = files.filter((f) => f.size > 0).slice(0, MAX_PHOTOS);
  if (!photos.length)
    return { error: "Add at least one photo of the product." };
  const ids: string[] = [];
  for (const f of photos) {
    const up = await uploadSocialImage(shop, f);
    if (!("imageId" in up) || !up.imageId)
      return { error: up.error ?? "Couldn't read one of the photos." };
    ids.push(up.imageId);
  }
  return { ids };
}

const SYSTEM = `You write complete product listings for a small online store from photos of the product, its label and its packaging. Look closely at every photo and read all the text you can see on labels, tags and boxes.

Write:
- title: the product's name as a shopper would search for it: brand (if shown), what it is, and the key variant such as size, scent, colour or quantity. At most 120 characters, no capitals for emphasis, no keyword stuffing.
- description: 2 to 4 short paragraphs separated by a blank line, in plain friendly sentences: what it is, what it's like (materials, size, look, feel), who it's for or how to use it. Only state facts you can see in the photos or that are given in the notes. No made-up claims, awards, reviews or health promises.
- productType: a short plain product type, such as "Scented candle".
- vendor: the brand shown on the product or pack, or empty if none is shown.
- tags: 3 to 8 short lowercase tags a shopper or the store might filter by.
- categoryPath: where it sits in Shopify's standard product taxonomy, from broad to narrow, separated by " > ", such as "Home & Garden > Decor > Home Fragrances > Candles".
- categorySearch: the one or two words to search the taxonomy for the narrowest category, such as "candles".
- attributes: the product's specifics as name and value pairs, such as Material, Colour, Size, Dimensions, Weight, Volume, Capacity, Scent, Pattern, Age group, Pack contents. Only include ones you can see or that the notes give.
- seoTitle: the page title for Google, 50 to 60 characters, starting with what the product is.
- seoDescription: a meta description of 140 to 155 characters saying what it is and its main benefit.
- compliance: the EU General Product Safety Regulation details, copied from what's printed on the label or pack: manufacturer, manufacturerAddress (postal address plus email or website), euResponsiblePerson (name and address of the EU-based responsible person if shown), countryOfOrigin ("Made in ..."), materials (or ingredients), warnings (safety warnings and age limits, word for word where you can read them), care (care or use instructions), marks (CE, UKCA, age, recycling or other marks you can see). Leave a field empty if it isn't shown or given. Never invent an address, company or warning.
- check: short notes for the merchant on what to check or add before publishing, such as details you couldn't read, guesses you made, or required safety details that weren't shown.

Write in the store's market language (British English for GB, American English for US).`;

const str = { type: "string" };
const SCHEMA = {
  type: "object",
  properties: {
    title: str,
    description: str,
    productType: str,
    vendor: str,
    tags: { type: "array", items: str },
    categoryPath: str,
    categorySearch: str,
    attributes: {
      type: "array",
      items: {
        type: "object",
        properties: { name: str, value: str },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
    seoTitle: str,
    seoDescription: str,
    compliance: {
      type: "object",
      properties: {
        manufacturer: str,
        manufacturerAddress: str,
        euResponsiblePerson: str,
        countryOfOrigin: str,
        materials: str,
        warnings: str,
        care: str,
        marks: str,
      },
      required: [
        "manufacturer",
        "manufacturerAddress",
        "euResponsiblePerson",
        "countryOfOrigin",
        "materials",
        "warnings",
        "care",
        "marks",
      ],
      additionalProperties: false,
    },
    check: { type: "array", items: str },
  },
  required: [
    "title",
    "description",
    "productType",
    "vendor",
    "tags",
    "categoryPath",
    "categorySearch",
    "attributes",
    "seoTitle",
    "seoDescription",
    "compliance",
    "check",
  ],
  additionalProperties: false,
};

type Answer = Omit<Listing, "categoryId" | "price"> & {
  categorySearch: string;
};

const clip = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, n);

const CATEGORIES = `#graphql
  query Categories($search: String!) {
    taxonomy { categories(first: 8, search: $search) { nodes { id fullName isLeaf } } }
  }`;

// Shopify's standard categories matching a search, the closest to Claude's
// path first.
export async function findCategories(
  graphql: Graphql,
  search: string,
  path = "",
): Promise<Category[]> {
  if (!search.trim()) return [];
  try {
    const res = (await graphql(CATEGORIES, {
      search: search.trim().slice(0, 60),
    })) as {
      data?: {
        taxonomy?: {
          categories?: {
            nodes?: { id: string; fullName: string; isLeaf: boolean }[];
          };
        };
      };
    };
    const nodes = res.data?.taxonomy?.categories?.nodes ?? [];
    const words = new Set(
      path
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
    const score = (n: { fullName: string; isLeaf: boolean }) =>
      n.fullName
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => words.has(w)).length + (n.isLeaf ? 0.5 : 0);
    return [...nodes]
      .sort((a, b) => score(b) - score(a))
      .map((n) => ({ id: n.id, fullName: n.fullName }));
  } catch (err) {
    console.error("Couldn't search Shopify's categories", err);
    return [];
  }
}

// The listing Claude writes from the saved photos and the merchant's notes.
export async function draftListing(
  shop: string,
  imageIds: string[],
  notes: string,
  {
    ask = claudeJson(),
    graphql = null,
  }: { ask?: AskJson | null; graphql?: Graphql | null } = {},
): Promise<{ error: string } | { listing: Listing; categories: Category[] }> {
  if (!ask)
    return {
      error:
        "Writing listings needs Claude, which isn't switched on for this app yet.",
    };
  const photos = await db.socialImage.findMany({
    where: { shop, id: { in: imageIds.slice(0, MAX_PHOTOS) } },
  });
  if (!photos.length)
    return { error: "Add at least one photo of the product." };
  const [settings, ws] = await Promise.all([
    db.shopSettings.findUnique({
      where: { shop },
      select: { market: true, domain: true },
    }),
    isWebShop(shop)
      ? db.workspace.findUnique({
          where: { shop },
          select: { website: true, country: true },
        })
      : null,
  ]);
  let a: Answer;
  try {
    a = (await ask(
      SYSTEM,
      {
        website: ws?.website ?? settings?.domain ?? null,
        market: ws?.country ?? settings?.market ?? "US",
        photos: photos.length,
        notes: notes.trim().slice(0, 1500) || null,
      },
      SCHEMA,
      photos.map((p) => ({
        data: Buffer.from(p.data).toString("base64"),
        mediaType: "image/jpeg" as const,
      })),
    )) as Answer;
  } catch (err) {
    console.error("Couldn't write a listing from photos", shop, err);
    return {
      error: "Couldn't write the listing just now. Try again in a minute.",
    };
  }
  const compliance = emptyCompliance();
  for (const k of Object.keys(compliance) as (keyof Compliance)[])
    compliance[k] = clip(a.compliance?.[k], 600);
  const categories = graphql
    ? await findCategories(
        graphql,
        clip(a.categorySearch, 60) || clip(a.productType, 60),
        clip(a.categoryPath, 300),
      )
    : [];
  const listing: Listing = {
    title: clip(a.title, LIMITS.title),
    description: String(a.description ?? "")
      .trim()
      .slice(0, 5000),
    productType: clip(a.productType, 255),
    vendor: clip(a.vendor, 255),
    tags: (a.tags ?? [])
      .map((t) => clip(t, 40))
      .filter(Boolean)
      .slice(0, 12),
    categoryPath: clip(a.categoryPath, 300),
    categoryId: categories[0]?.id ?? null,
    attributes: (a.attributes ?? [])
      .map((x) => ({ name: clip(x.name, 60), value: clip(x.value, 200) }))
      .filter((x) => x.name && x.value)
      .slice(0, 20),
    seoTitle: clip(a.seoTitle, 70),
    seoDescription: clip(a.seoDescription, 170),
    compliance,
    check: (a.check ?? [])
      .map((c) => clip(c, 300))
      .filter(Boolean)
      .slice(0, 10),
    price: "",
  };
  if (!listing.title)
    return {
      error:
        "Claude couldn't tell what the product is from those photos. Try clearer photos, or add a note.",
    };
  return { listing, categories };
}

const CREATE = `#graphql
  mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product { id handle variants(first: 1) { nodes { id } } }
      userErrors { field message }
    }
  }`;

const PRICE = `#graphql
  mutation SetPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }`;

const imageUrl = (id: string) =>
  `${process.env.SHOPIFY_APP_URL || ""}/social-images/${id}.jpg`;

// Creates the product in Shopify as a draft, with its photos, so the merchant
// can look it over there before it goes on sale.
export async function createListing(
  shop: string,
  graphql: Graphql,
  listing: Listing,
  imageIds: string[],
) {
  const title = clip(listing.title, 255);
  if (!title) return { error: "The product needs a title." };
  const owned = await db.socialImage.findMany({
    where: { shop, id: { in: imageIds.slice(0, MAX_PHOTOS) } },
    select: { id: true },
  });
  const ids = imageIds.filter((id) => owned.some((o) => o.id === id));
  const attributes = listing.attributes.filter(
    (a) => a.name.trim() && a.value.trim(),
  );
  const compliance = Object.fromEntries(
    Object.entries(listing.compliance).filter(([, v]) => String(v).trim()),
  );
  const metafields = [
    ...(attributes.length
      ? [
          {
            namespace: "similarwise",
            key: "attributes",
            type: "json",
            value: JSON.stringify(attributes),
          },
        ]
      : []),
    ...(Object.keys(compliance).length
      ? [
          {
            namespace: "similarwise",
            key: "eu_safety",
            type: "json",
            value: JSON.stringify(compliance),
          },
        ]
      : []),
  ];
  const product = {
    title,
    descriptionHtml: descriptionHtml(listing),
    productType: clip(listing.productType, 255) || null,
    vendor: clip(listing.vendor, 255) || null,
    tags: listing.tags.map((t) => clip(t, 40)).filter(Boolean),
    ...(listing.categoryId ? { category: listing.categoryId } : {}),
    seo: {
      title: clip(listing.seoTitle, 70) || null,
      description: clip(listing.seoDescription, 320) || null,
    },
    status: "DRAFT",
    ...(metafields.length ? { metafields } : {}),
  };
  const media = ids.map((id, i) => ({
    originalSource: imageUrl(id),
    mediaContentType: "IMAGE",
    alt: i === 0 ? title : `${title}, photo ${i + 1}`,
  }));
  let res: {
    data?: {
      productCreate?: {
        product?: {
          id: string;
          handle: string;
          variants?: { nodes?: { id: string }[] };
        } | null;
        userErrors?: { message: string }[];
      };
    };
    errors?: { message: string }[];
  };
  try {
    res = (await graphql(CREATE, { product, media })) as typeof res;
  } catch (err) {
    console.error("Couldn't create a product from photos", shop, err);
    return {
      error: "Couldn't create the product just now. Try again in a minute.",
    };
  }
  const problem =
    res.data?.productCreate?.userErrors?.[0]?.message ??
    res.errors?.[0]?.message;
  const made = res.data?.productCreate?.product;
  if (problem || !made)
    return { error: problem ?? "Shopify didn't create the product." };
  let warning: string | null = null;
  const price = listing.price.trim().replace(/[^\d.]/g, "");
  const variant = made.variants?.nodes?.[0]?.id;
  if (price && Number(price) > 0 && variant) {
    try {
      const p = (await graphql(PRICE, {
        productId: made.id,
        variants: [{ id: variant, price: Number(price).toFixed(2) }],
      })) as {
        data?: {
          productVariantsBulkUpdate?: { userErrors?: { message: string }[] };
        };
      };
      const e = p.data?.productVariantsBulkUpdate?.userErrors?.[0]?.message;
      if (e)
        warning = `The product was created, but its price wasn't set: ${e}`;
    } catch {
      warning =
        "The product was created, but its price wasn't set. Add it in Shopify.";
    }
  }
  return {
    ok: true as const,
    productId: made.id,
    numericId: made.id.split("/").pop() ?? "",
    warning,
  };
}
