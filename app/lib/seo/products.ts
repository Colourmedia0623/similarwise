// Shared by the Product SEO page and its server code (products.server.ts).

export const LIMITS = { title: 120, seoTitle: 60, seoDescription: 155 };
export const PAGE_SIZE = 20;

export type SeoProduct = {
  id: string;
  handle: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  description: string;
  productType: string | null;
  image: string | null;
  url: string | null;
  // A web product whose page hasn't been read yet, so its SEO fields aren't known.
  unread?: boolean;
};

export type Suggestion = { title: string; seoTitle: string; seoDescription: string; why: string | null; appliedAt: string | null; createdAt: string };
