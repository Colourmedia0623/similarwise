import db from "../db.server";
import { FEATURES, PRICE, REVENUE, TRACKING, type Option, type SurveyAnswers } from "./survey";

// Colourmedia's own stores: the only ones that see the survey results in the app.
const OWNER_SHOPS = (process.env.OWNER_SHOPS ?? "gift-boxes-3000.myshopify.com,colourmedia-8652.myshopify.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const isOwnerShop = (shop: string) => OWNER_SHOPS.includes(shop);

export async function saveSurvey(a: SurveyAnswers) {
  const data = {
    store: a.store,
    revenue: a.revenue,
    tracking: JSON.stringify(a.tracking),
    features: JSON.stringify(a.features),
    price: a.price,
    question: a.question,
  };
  await db.waitlistEntry.upsert({ where: { email: a.email }, create: { email: a.email, ...data }, update: data });
}

export type Tally = { label: string; count: number }[];

const tally = (options: Option[], picks: string[]): Tally =>
  options.map((o) => ({ label: o.label, count: picks.filter((p) => p === o.value).length }));

const list = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

// The survey results, measured against the pitch test's targets: 20 answers,
// 30% paying $49 a month or more, 100 sign-ups and the top three features.
export async function surveyResults() {
  const rows = await db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" } });
  const willPay49 = rows.filter((r) => Number(r.price) >= 49).length;
  return {
    total: rows.length,
    willPay49,
    willPay49Share: rows.length ? willPay49 / rows.length : 0,
    revenue: tally(REVENUE, rows.map((r) => r.revenue)),
    tracking: tally(TRACKING, rows.flatMap((r) => list(r.tracking))),
    features: tally(FEATURES, rows.flatMap((r) => list(r.features))).sort((a, b) => b.count - a.count),
    price: tally(PRICE, rows.map((r) => r.price)),
    entries: rows.map((r) => ({
      email: r.email,
      store: r.store,
      revenue: REVENUE.find((o) => o.value === r.revenue)?.label ?? r.revenue,
      price: PRICE.find((o) => o.value === r.price)?.label ?? r.price,
      features: list(r.features).map((f) => FEATURES.find((o) => o.value === f)?.label ?? f),
      question: r.question,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
