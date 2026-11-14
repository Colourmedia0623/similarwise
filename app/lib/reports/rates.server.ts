import type { Rates } from "./report";

// Exchange rates for showing reports in one currency: the European Central
// Bank's daily reference rates, through Frankfurter (free, no key). Kept for
// six hours; when they can't be read, figures stay in their own currencies.

type Fetch = typeof fetch;
const URL_LATEST = "https://api.frankfurter.dev/v1/latest?base=USD";
const KEEP = 6 * 3600_000;

let cached: { at: number; rates: Rates } | null = null;

export function parseRates(json: unknown): Rates | null {
  const j = json as { date?: unknown; rates?: Record<string, unknown> } | null;
  if (
    !j ||
    typeof j.date !== "string" ||
    !j.rates ||
    typeof j.rates !== "object"
  )
    return null;
  const perUsd: Record<string, number> = {};
  for (const [k, v] of Object.entries(j.rates))
    if (typeof v === "number" && v > 0 && /^[A-Z]{3}$/.test(k)) perUsd[k] = v;
  return Object.keys(perUsd).length ? { date: j.date, perUsd } : null;
}

export async function exchangeRates({
  f = fetch,
  now = Date.now(),
}: { f?: Fetch; now?: number } = {}): Promise<Rates | null> {
  if (cached && now - cached.at < KEEP) return cached.rates;
  try {
    const res = await f(URL_LATEST, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Frankfurter said ${res.status}`);
    const rates = parseRates(await res.json());
    if (!rates) throw new Error("Frankfurter sent no rates");
    cached = { at: now, rates };
    return rates;
  } catch (err) {
    console.error(
      "Couldn't read exchange rates",
      err instanceof Error ? err.message : err,
    );
    return cached?.rates ?? null; // Older rates beat none.
  }
}

export const forgetRates = () => {
  cached = null;
};
