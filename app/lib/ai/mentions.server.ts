import db from "../../db.server";
import { claudeJson, type AskJson } from "../ideas/claude.server";
import { brandTerm, poster, taskResult } from "../traffic/dataforseo.server";
import { shopDomain } from "../traffic/gap.server";
import { shopMarket } from "../traffic/refresh.server";
import { marketFor, type Market } from "../traffic/markets";
import { hostOf } from "../tracker/url";

// AI mentions: the questions shoppers ask AI assistants ("what are the best
// magnetic gift boxes in the UK?"), asked of ChatGPT, Gemini and Perplexity
// each week through DataForSEO, to see whether they name the shop or its
// competitors, and which sites they quote.

export const PLATFORMS = [
  { key: "chat_gpt", name: "ChatGPT", model: "gpt-4.1-mini" },
  { key: "gemini", name: "Gemini", model: "gemini-2.5-flash" },
  { key: "perplexity", name: "Perplexity", model: "sonar" },
] as const;
export type Platform = (typeof PLATFORMS)[number]["key"];

const WEEK = 7 * 86400_000;
const MIN_GAP = 6 * 3600_000; // Between checks the merchant starts
const STUCK = 3600_000;
const KEEP = 90 * 86400_000;
export const MAX_PROMPTS = 15;
const AT_ONCE = 4;

export type Source = { url: string; title: string | null; domain: string };
export type Answer = { text: string; sources: Source[] };
export type AiClient = (platform: Platform, prompt: string, market: Market) => Promise<Answer>;

// An answer's words and the pages it cited.
export function parseAnswer(json: unknown): Answer {
  const items = (taskResult(json)[0]?.items ?? []) as { type?: string; sections?: { text?: string | null; annotations?: { url?: string; title?: string }[] | null }[] }[];
  const texts: string[] = [];
  const sources = new Map<string, Source>();
  for (const it of items) {
    if (it.type !== "message") continue;
    for (const s of it.sections ?? []) {
      if (s.text) texts.push(s.text);
      for (const a of s.annotations ?? []) {
        if (!a.url || sources.has(a.url)) continue;
        try {
          sources.set(a.url, { url: a.url.slice(0, 500), title: a.title?.slice(0, 200) ?? null, domain: new URL(a.url).hostname.replace(/^www\./, "") });
        } catch {
          // Not a link.
        }
      }
    }
  }
  return { text: texts.join("\n\n").slice(0, 20_000), sources: [...sources.values()].slice(0, 30) };
}

export function aiClient(): AiClient | null {
  const post = poster(150_000);
  if (!post) return null;
  return async (platform, prompt, market) => {
    const p = PLATFORMS.find((x) => x.key === platform)!;
    const task: Record<string, unknown> = { user_prompt: prompt.slice(0, 500), model_name: p.model, max_output_tokens: 1500 };
    // Perplexity always searches the web; the others are told to, as the apps do.
    if (platform === "chat_gpt") Object.assign(task, { web_search: true, web_search_country_iso_code: market.code });
    if (platform === "gemini") task.web_search = true;
    return parseAnswer(await post(`/ai_optimization/${platform}/llm_responses/live`, task));
  };
}

export type Brand = { key: string; name: string; domain: string | null; terms: string[] };

const LEGAL = /\s+(ltd|limited|llc|inc|plc|co|uk|store|shop)\.?$/i;

// The names a site is called by: its own name and its domain's name.
export function brandTerms(name: string | null, domain: string | null) {
  const terms = new Set<string>();
  const clean = name?.trim().replace(LEGAL, "").toLowerCase();
  if (clean && clean.length >= 3) terms.add(clean);
  if (domain) {
    terms.add(domain.toLowerCase().replace(/^www\./, ""));
    const term = brandTerm(domain);
    if (term) terms.add(term);
  }
  return [...terms];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Named = { key: string; position: number; cited: boolean };

// Which brands an answer names, in the order it first names them, and
// whether it cites their site.
export function findBrands(answer: Answer, brands: Brand[]): Named[] {
  const text = answer.text.toLowerCase();
  const hits = brands.flatMap((b) => {
    const at = Math.min(
      ...b.terms.map((t) => {
        const m = new RegExp(`(^|[^a-z0-9])${escape(t)}(?![a-z0-9])`, "i").exec(text);
        return m ? m.index : Infinity;
      }),
    );
    const cited = !!b.domain && answer.sources.some((s) => s.domain === b.domain || s.domain.endsWith(`.${b.domain}`));
    return at < Infinity || cited ? [{ key: b.key, at: at < Infinity ? at : Number.MAX_SAFE_INTEGER, cited }] : [];
  });
  return hits.sort((a, b) => a.at - b.at).map((h, i) => ({ key: h.key, position: i + 1, cited: h.cited }));
}

export async function shopBrands(shop: string): Promise<Brand[]> {
  const [settings, domain, competitors] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    shopDomain(shop),
    db.competitor.findMany({ where: { shop }, select: { id: true, name: true, url: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const name = settings?.aiBrand ?? null;
  const you: Brand = { key: "you", name: name || domain || "Your shop", domain, terms: brandTerms(name, domain) };
  return [
    you,
    ...competitors.map((c) => {
      const d = hostOf(c.url).replace(/^www\./, "");
      return { key: c.id, name: c.name, domain: d, terms: brandTerms(c.name, d) };
    }),
  ];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompts"],
  properties: { prompts: { type: "array", items: { type: "string" } } },
};

const SYSTEM = `You write the questions a shopper would type into ChatGPT, Gemini or Perplexity when looking for what a small online shop sells, so the shop can see whether AI assistants recommend it. You get the shop's market, website, product titles, and the Google searches it wants to win.

Write the number of questions asked for, in the market's spelling, each under 150 characters. Ask the way people really ask an assistant: "What are the best places to buy...", "Where can I get... in the UK?", "Which ... is good for ...?", "Recommend a ... for ...". Cover the shop's main kinds of product and the occasions people buy them for. Never name the shop or any brand. No two questions alike.`;

// Claude suggests questions from the shop's products and keyword gap.
export async function suggestPrompts(shop: string, ask: AskJson | null = claudeJson()) {
  if (!ask) return { error: "AI mentions aren't switched on for this app yet." };
  const existing = await db.aiPrompt.findMany({ where: { shop }, select: { prompt: true } });
  const wanted = Math.min(10, MAX_PROMPTS - existing.length);
  if (wanted <= 0) return { error: `You have ${MAX_PROMPTS} questions already. Delete some first.` };
  const [domain, market, products, gap] = await Promise.all([
    shopDomain(shop),
    shopMarket(shop),
    db.shopProduct.findMany({ where: { shop }, orderBy: { title: "asc" }, take: 150, select: { title: true } }),
    db.keywordGap.findMany({ where: { competitor: { shop } }, orderBy: { searchVolume: "desc" }, take: 40, select: { keyword: true }, distinct: ["keyword"] }),
  ]);
  if (!products.length && !gap.length) return { error: "Add some products to your store first, or refresh the Keyword gap page." };
  const out = (await ask(
    SYSTEM,
    { market: market.name, website: domain, questionsWanted: wanted, products: products.map((p) => p.title), searches: gap.map((g) => g.keyword), alreadyAsking: existing.map((e) => e.prompt) },
    SCHEMA,
  )) as { prompts?: unknown } | null;
  const seen = new Set(existing.map((e) => e.prompt.toLowerCase()));
  const prompts = (Array.isArray(out?.prompts) ? out.prompts : [])
    .flatMap((p) => (typeof p === "string" && p.trim() ? [p.trim().slice(0, 300)] : []))
    .filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
    .slice(0, wanted);
  if (!prompts.length) return { error: "Couldn't think of any questions. Try again." };
  await db.aiPrompt.createMany({ data: prompts.map((prompt) => ({ shop, prompt })) });
  return { count: prompts.length };
}

const cleanPrompt = (p: string) => p.trim().replace(/\s+/g, " ").slice(0, 300);

export async function addPrompt(shop: string, text: string) {
  const prompt = cleanPrompt(text);
  if (prompt.length < 8) return { error: "Write the question as a shopper would ask it." };
  if ((await db.aiPrompt.count({ where: { shop } })) >= MAX_PROMPTS) return { error: `You can ask up to ${MAX_PROMPTS} questions. Delete one first.` };
  await db.aiPrompt.create({ data: { shop, prompt } });
  return { ok: true as const };
}

// A changed question starts its answers again.
export async function editPrompt(shop: string, id: string, text: string) {
  const prompt = cleanPrompt(text);
  if (prompt.length < 8) return { error: "Write the question as a shopper would ask it." };
  const old = await db.aiPrompt.findFirst({ where: { id, shop } });
  if (!old) return { error: "That question isn't there any more." };
  if (old.prompt === prompt) return { ok: true as const };
  await db.$transaction([db.aiPrompt.update({ where: { id }, data: { prompt } }), db.aiAnswer.deleteMany({ where: { promptId: id } })]);
  return { ok: true as const };
}

export async function deletePrompt(shop: string, id: string) {
  const { count } = await db.aiPrompt.deleteMany({ where: { id, shop } });
  if (count) await db.aiAnswer.deleteMany({ where: { promptId: id, shop } });
}

export async function setAiBrand(shop: string, name: string) {
  const aiBrand = name.trim().slice(0, 100) || null;
  await db.shopSettings.upsert({ where: { shop }, update: { aiBrand }, create: { shop, aiBrand } });
}

// Fills in the brand name from the Shopify store's name the first time.
export async function detectAiBrand(shop: string, readName: () => Promise<string | null>) {
  const s = await db.shopSettings.findUnique({ where: { shop } });
  if (s?.aiBrand) return;
  const name = await readName().catch(() => null);
  if (name) await db.shopSettings.upsert({ where: { shop }, update: { aiBrand: name.slice(0, 100) }, create: { shop, aiBrand: name.slice(0, 100) } });
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// Asks every question of every assistant and keeps the answers. Claims the
// shop first so two checks can't run at once.
export async function runAiCheck(shop: string, { client = aiClient(), now = new Date() }: { client?: AiClient | null; now?: Date } = {}) {
  if (!client) return { error: "AI mentions aren't switched on for this app yet." };
  await db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });
  const { count } = await db.shopSettings.updateMany({
    where: { shop, OR: [{ aiRunningAt: null }, { aiRunningAt: { lt: new Date(now.getTime() - STUCK) } }] },
    data: { aiRunningAt: now },
  });
  if (!count) return { error: "A check is already running." };
  try {
    const [prompts, brands, market] = await Promise.all([db.aiPrompt.findMany({ where: { shop } }), shopBrands(shop), shopMarket(shop)]);
    const jobs = prompts.flatMap((p) => PLATFORMS.map((pl) => ({ prompt: p, platform: pl.key })));
    let failed = 0;
    let lastError = "";
    await inBatches(jobs, AT_ONCE, async ({ prompt, platform }) => {
      try {
        const answer = await client(platform, prompt.prompt, market);
        await db.aiAnswer.create({
          data: { shop, promptId: prompt.id, platform, ranAt: now, text: answer.text, sources: JSON.stringify(answer.sources), brands: JSON.stringify(findBrands(answer, brands)) },
        });
      } catch (err) {
        failed++;
        lastError = err instanceof Error ? err.message : String(err);
        console.error("Couldn't ask an AI assistant", shop, platform, err);
        await db.aiAnswer.create({ data: { shop, promptId: prompt.id, platform, ranAt: now, error: lastError.slice(0, 300) } });
      }
    });
    const aiError = jobs.length && failed === jobs.length ? `Couldn't ask the assistants: ${lastError}`.slice(0, 300) : null;
    await db.aiAnswer.deleteMany({ where: { shop, ranAt: { lt: new Date(now.getTime() - KEEP) } } });
    await db.shopSettings.update({ where: { shop }, data: { aiCheckedAt: now, aiRunningAt: null, aiError } });
    return aiError ? { error: aiError } : { ok: true as const };
  } catch (err) {
    await db.shopSettings.update({ where: { shop }, data: { aiRunningAt: null } });
    throw err;
  }
}

// A check the merchant starts. It runs in the background, since asking
// every assistant takes a few minutes.
export async function startAiCheck(shop: string, { client = aiClient(), now = new Date() }: { client?: AiClient | null; now?: Date } = {}) {
  if (!client) return { error: "AI mentions aren't switched on for this app yet." };
  if (!(await db.aiPrompt.count({ where: { shop } }))) return { error: "Add some questions first." };
  const s = await db.shopSettings.findUnique({ where: { shop } });
  if (s?.aiRunningAt && now.getTime() - s.aiRunningAt.getTime() < STUCK) return { error: "A check is already running." };
  if (s?.aiCheckedAt && now.getTime() - s.aiCheckedAt.getTime() < MIN_GAP) return { error: "You checked in the last few hours. Answers change slowly, so try again later." };
  void runAiCheck(shop, { client, now }).catch((err) => console.error("AI check failed", shop, err));
  return { started: true as const };
}

// The weekly run, from the hourly schedule.
export async function refreshAllAiMentions({ client = aiClient(), now = new Date() }: { client?: AiClient | null; now?: Date } = {}) {
  if (!client) return;
  const shops = await db.aiPrompt.findMany({ select: { shop: true }, distinct: ["shop"] });
  for (const { shop } of shops) {
    const s = await db.shopSettings.findUnique({ where: { shop } });
    if (s?.aiCheckedAt && now.getTime() - s.aiCheckedAt.getTime() < WEEK) continue;
    await runAiCheck(shop, { client, now }).catch((err) => console.error("AI check failed", shop, err));
  }
}

const parse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

const share = (answers: { brands: Named[] }[], key: string) => (answers.length ? Math.round((100 * answers.filter((a) => a.brands.some((b) => b.key === key)).length) / answers.length) : null);

// Everything the AI mentions page shows.
export async function aiVisibility(shop: string) {
  const [settings, prompts, brands, runs] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.aiPrompt.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
    shopBrands(shop),
    db.aiAnswer.findMany({ where: { shop }, select: { ranAt: true }, distinct: ["ranAt"], orderBy: { ranAt: "desc" }, take: 12 }),
  ]);
  const latest = runs[0]?.ranAt;
  const rows = latest ? await db.aiAnswer.findMany({ where: { shop, ranAt: { in: runs.map((r) => r.ranAt) } } }) : [];
  const answers = rows.map((a) => ({ ...a, brands: parse<Named[]>(a.brands, []), sources: parse<Source[]>(a.sources, []) }));
  const ok = (at: Date | undefined) => answers.filter((a) => at && a.ranAt.getTime() === at.getTime() && !a.error);
  const now = ok(latest);
  const before = ok(runs[1]?.ranAt);
  const name = new Map(brands.map((b) => [b.key, b.name]));

  const sourceCount = new Map<string, number>();
  for (const a of now) for (const d of new Set(a.sources.map((s) => s.domain))) sourceCount.set(d, (sourceCount.get(d) ?? 0) + 1);
  const brandOf = (domain: string) => brands.find((b) => b.domain && (domain === b.domain || domain.endsWith(`.${b.domain}`)));

  return {
    brand: settings?.aiBrand ?? "",
    domain: brands[0].domain,
    running: !!settings?.aiRunningAt && Date.now() - settings.aiRunningAt.getTime() < STUCK,
    checkedAt: settings?.aiCheckedAt?.toISOString() ?? null,
    error: settings?.aiError ?? null,
    market: marketFor(settings?.market).name,
    answered: now.length,
    brands: brands
      .map((b) => ({
        key: b.key,
        name: b.name,
        share: share(now, b.key),
        before: share(before, b.key),
        platforms: PLATFORMS.map((p) => ({ name: p.name, share: share(now.filter((a) => a.platform === p.key), b.key) })),
      }))
      .sort((a, b) => (a.key === "you" ? -1 : b.key === "you" ? 1 : (b.share ?? 0) - (a.share ?? 0))),
    history: [...runs].reverse().map((r) => ({ at: r.ranAt.toISOString(), you: share(ok(r.ranAt), "you") })),
    prompts: prompts.map((p) => ({
      id: p.id,
      prompt: p.prompt,
      answers: PLATFORMS.map((pl) => {
        const a = answers.find((x) => latest && x.ranAt.getTime() === latest.getTime() && x.promptId === p.id && x.platform === pl.key);
        return {
          platform: pl.name,
          asked: !!a,
          error: a?.error ?? null,
          you: a?.brands.find((b) => b.key === "you")?.position ?? null,
          named: (a?.brands ?? []).map((b) => ({ ...b, name: name.get(b.key) ?? "?" })),
          text: a?.text ?? "",
          sources: a?.sources ?? [],
        };
      }),
    })),
    sources: [...sourceCount]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([domain, count]) => ({ domain, count, brand: brandOf(domain)?.key ?? null })),
  };
}

// How often the latest check's answers named the shop, for the home page.
export async function aiShare(shop: string) {
  const last = await db.aiAnswer.findFirst({ where: { shop }, orderBy: { ranAt: "desc" }, select: { ranAt: true } });
  if (!last) return null;
  const rows = await db.aiAnswer.findMany({ where: { shop, ranAt: last.ranAt, error: null }, select: { brands: true } });
  return share(rows.map((r) => ({ brands: parse<Named[]>(r.brands, []) })), "you");
}
