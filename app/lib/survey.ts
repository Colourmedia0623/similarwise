// The early-access survey on the public landing page. Each question's options
// map to what the pitch test needs to prove: who answers, what they'd pay, and
// which features they want most.

export type Option = { value: string; label: string };

export const REVENUE: Option[] = [
  { value: "under_250k", label: "Under $250k a year" },
  { value: "250k_1m", label: "$250k to $1M" },
  { value: "1m_10m", label: "$1M to $10M" },
  { value: "over_10m", label: "Over $10M" },
];

export const TRACKING: Option[] = [
  { value: "visit_sites", label: "I visit their websites" },
  { value: "ad_libraries", label: "Meta or TikTok ad libraries" },
  { value: "seo_tools", label: "SimilarWeb, Semrush or Ahrefs" },
  { value: "spy_tools", label: "Spy tools or browser extensions" },
  { value: "agency", label: "My agency does it" },
  { value: "none", label: "I don't, yet" },
];

export const FEATURES: Option[] = [
  { value: "products_prices", label: "New products and price changes" },
  { value: "ads", label: "The ads they run on Meta, TikTok and Google" },
  { value: "search", label: "Their search traffic and keywords" },
  { value: "spend", label: "How much they spend on ads" },
  { value: "channels", label: "Where their traffic comes from" },
  { value: "you_vs_them", label: "How my store compares with theirs" },
  { value: "alerts", label: "Alerts when something changes" },
  { value: "digest", label: "A weekly summary email" },
];

export const PRICE: Option[] = [
  { value: "0", label: "I wouldn't pay for this" },
  { value: "19", label: "Up to $19 a month" },
  { value: "49", label: "$49 a month" },
  { value: "149", label: "$149 a month" },
  { value: "399", label: "$399 a month or more" },
];

export const MAX_FEATURES = 3;

export type SurveyAnswers = {
  email: string;
  store: string | null;
  revenue: string;
  tracking: string[];
  features: string[];
  price: string;
  question: string | null;
};

const known = (options: Option[], values: string[]) => {
  const allowed = new Set(options.map((o) => o.value));
  return [...new Set(values)].filter((v) => allowed.has(v));
};

const text = (v: FormDataEntryValue | null, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

export function parseSurvey(form: FormData): { ok: true; answers: SurveyAnswers } | { ok: false; error: string } {
  const email = text(form.get("email"), 200)?.toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Please enter a valid email address." };
  const revenue = known(REVENUE, [String(form.get("revenue") ?? "")])[0];
  if (!revenue) return { ok: false, error: "Please choose your store's yearly revenue." };
  const features = known(FEATURES, form.getAll("features").map(String));
  if (features.length === 0) return { ok: false, error: "Please pick at least one feature." };
  if (features.length > MAX_FEATURES) return { ok: false, error: `Please pick at most ${MAX_FEATURES} features.` };
  const price = known(PRICE, [String(form.get("price") ?? "")])[0];
  if (!price) return { ok: false, error: "Please choose what you'd pay." };
  return {
    ok: true,
    answers: {
      email,
      store: text(form.get("store"), 200),
      revenue,
      tracking: known(TRACKING, form.getAll("tracking").map(String)),
      features,
      price,
      question: text(form.get("question"), 1000),
    },
  };
}
