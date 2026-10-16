import type { Market } from "./markets";

// DataForSEO Labs: estimated Google search traffic for a domain, and the
// keywords it ranks and advertises for. Pay per request; off unless
// DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are set.

const API = "https://api.dataforseo.com/v3";

export type DomainTraffic = {
  organicTraffic: number;
  organicKeywords: number;
  paidTraffic: number;
  paidKeywords: number;
  paidCostCents: number; // Estimated monthly Google search ads spend (USD)
};

export type RankedKeyword = {
  keyword: string;
  type: "organic" | "paid";
  position: number | null;
  searchVolume: number | null;
  traffic: number | null;
  url: string | null;
};

export type TrafficClient = {
  overview(domain: string, market: Market): Promise<DomainTraffic>;
  keywords(domain: string, market: Market): Promise<RankedKeyword[]>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const whole = (v: unknown) => Math.max(0, Math.round(num(v) ?? 0));

// One task's result list, or an error naming what DataForSEO said.
function taskResult(json: unknown): Record<string, unknown>[] {
  const body = json as { status_code?: number; status_message?: string; tasks?: unknown[] } | null;
  if (!body || body.status_code !== 20000) throw new Error(`DataForSEO: ${body?.status_message ?? "no response"}`);
  const task = body.tasks?.[0] as { status_code?: number; status_message?: string; result?: unknown[] } | undefined;
  if (!task || task.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no task"}`);
  return (task.result ?? []).filter(Boolean) as Record<string, unknown>[];
}

export function parseOverview(json: unknown): DomainTraffic {
  const item = (taskResult(json)[0]?.items as { metrics?: Record<string, Record<string, unknown>> }[] | undefined)?.[0];
  const organic = item?.metrics?.organic ?? {};
  const paid = item?.metrics?.paid ?? {};
  return {
    organicTraffic: whole(organic.etv),
    organicKeywords: whole(organic.count),
    paidTraffic: whole(paid.etv),
    paidKeywords: whole(paid.count),
    paidCostCents: whole((num(paid.estimated_paid_traffic_cost) ?? 0) * 100),
  };
}

export function parseKeywords(json: unknown): RankedKeyword[] {
  const items = (taskResult(json)[0]?.items ?? []) as {
    keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number } };
    ranked_serp_element?: { serp_item?: { type?: string; rank_group?: number; etv?: number; url?: string } };
  }[];
  const out: RankedKeyword[] = [];
  for (const it of items) {
    const keyword = it.keyword_data?.keyword;
    const serp = it.ranked_serp_element?.serp_item;
    if (!keyword || !serp || (serp.type !== "organic" && serp.type !== "paid")) continue;
    out.push({
      keyword: keyword.slice(0, 200),
      type: serp.type,
      position: num(serp.rank_group),
      searchVolume: num(it.keyword_data?.keyword_info?.search_volume),
      traffic: num(serp.etv) == null ? null : Math.round(serp.etv!),
      url: typeof serp.url === "string" ? serp.url.slice(0, 500) : null,
    });
  }
  return out;
}

export function trafficClient(): TrafficClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  const post = async (path: string, task: object) => {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`DataForSEO answered ${res.status}`);
    return res.json();
  };
  return {
    async overview(domain, market) {
      return parseOverview(
        await post("/dataforseo_labs/google/domain_rank_overview/live", {
          target: domain,
          location_code: market.location,
          language_code: market.language,
        }),
      );
    },
    async keywords(domain, market) {
      const top = (type: "organic" | "paid") =>
        post("/dataforseo_labs/google/ranked_keywords/live", {
          target: domain,
          location_code: market.location,
          language_code: market.language,
          item_types: [type],
          limit: 20,
          order_by: ["ranked_serp_element.serp_item.etv,desc"],
        }).then(parseKeywords);
      const [organic, paid] = await Promise.all([top("organic"), top("paid")]);
      return [...organic, ...paid];
    },
  };
}
