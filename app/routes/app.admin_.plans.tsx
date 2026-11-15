import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { webAccountFor } from "../lib/web/context.server";
import { isAdminEmail } from "../lib/web/admin.server";
import { isWebShop } from "../lib/web/shop";
import { PLANS, type Tier } from "../lib/billing";
import { LIMITS, PLAN_PAGES, type LimitKey, type PlanConfig } from "../lib/plans";
import { defaultPlanConfig, planConfig, savePlanConfig, setShopLimits } from "../lib/plans.server";

// Admin → Packages: what each plan includes (limits, pages and the list on
// the plans page), and limits for one customer alone. Only for ADMIN_EMAILS.

async function requireAdmin(request: Request) {
  await authenticate.admin(request);
  const account = await webAccountFor(request);
  if (!account || !isAdminEmail(account.user.email)) throw new Response("Not found", { status: 404 });
}

const TIERS = PLANS.map((p) => p.tier);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const [config, workspaces, sessions, plans] = await Promise.all([
    planConfig(0),
    db.workspace.findMany({ select: { shop: true, name: true, website: true }, orderBy: { createdAt: "desc" } }),
    db.session.findMany({ distinct: ["shop"], select: { shop: true } }),
    db.shopPlan.findMany(),
  ]);
  const byShop = new Map(plans.map((p) => [p.shop, p]));
  const customers = [
    ...workspaces.map((w) => ({ shop: w.shop, name: w.name, detail: w.website ?? "No website", kind: "Web" })),
    ...sessions.filter((s) => !isWebShop(s.shop)).map((s) => ({ shop: s.shop, name: s.shop.replace(/\.myshopify\.com$/, ""), detail: s.shop, kind: "Shopify" })),
  ].map((c) => {
    const row = byShop.get(c.shop);
    return { ...c, tier: (row?.tier as Tier | null) ?? null, own: Object.fromEntries(LIMITS.map((l) => [l.key, row?.[l.key] ?? null])) as Record<LimitKey, number | null> };
  });
  return { config, defaults: defaultPlanConfig(), customers };
};

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : NaN;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "plans" || intent === "reset") {
    const next: PlanConfig = intent === "reset" ? defaultPlanConfig() : await planConfig(0);
    if (intent === "plans") {
      for (const t of TIERS) {
        for (const l of LIMITS) {
          const n = num(form.get(`limit.${t}.${l.key}`));
          if (n === null || Number.isNaN(n)) return { error: `Enter a whole number for ${l.label.toLowerCase()} on ${PLANS.find((p) => p.tier === t)!.name}.` };
          next.limits[t][l.key] = n;
        }
        next.includes[t] = String(form.get(`includes.${t}`) ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      for (const { path } of PLAN_PAGES) {
        const t = String(form.get(`page.${path}`) ?? "");
        if (TIERS.includes(t as Tier)) next.pages[path] = t as Tier;
      }
    }
    await savePlanConfig(next);
    return { ok: intent === "reset" ? "Packages are back to how they started." : "Packages saved. Customers see the changes straight away." };
  }
  if (intent === "customer") {
    const shop = String(form.get("shop") ?? "");
    const limits: Partial<Record<LimitKey, number | null>> = {};
    for (const l of LIMITS) {
      const n = num(form.get(l.key));
      if (Number.isNaN(n)) return { error: `Enter a whole number for ${l.label.toLowerCase()}, or leave it empty to follow the plan.` };
      limits[l.key] = n;
    }
    await setShopLimits(shop, limits);
    return { ok: "Saved this customer's limits." };
  }
  return { error: "Unknown action." };
};

export default function Packages() {
  const { config, customers } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const name = (t: Tier) => PLANS.find((p) => p.tier === t)!.name;
  return (
    <s-page heading="Packages">
      <style>{CSS}</style>
      {result && "ok" in result && <s-banner tone="success">{result.ok}</s-banner>}
      {result && "error" in result && <s-banner tone="critical">{result.error}</s-banner>}

      <Form method="post">
        <input type="hidden" name="intent" value="plans" />
        <s-section heading="Limits">
          <s-paragraph>How many of each thing a customer on each plan can have. Customers already over a new, lower limit keep what they have but can&rsquo;t add more.</s-paragraph>
          <table className="sw-pk">
            <thead>
              <tr>
                <th />
                {TIERS.map((t) => (
                  <th key={t}>{name(t)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LIMITS.map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  {TIERS.map((t) => (
                    <td key={t}>
                      <input type="number" min={0} max={10000} name={`limit.${t}.${l.key}`} defaultValue={config.limits[t][l.key]} required aria-label={`${l.label}, ${name(t)}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>

        <s-section heading="Which plan opens each page">
          <s-paragraph>A page is open on the plan chosen here and every plan above it. Pages not listed, such as the Overview, Setup and Settings, are open on every plan.</s-paragraph>
          <table className="sw-pk">
            <tbody>
              {PLAN_PAGES.map((p) => (
                <tr key={p.path}>
                  <td>{p.label}</td>
                  <td>
                    <select name={`page.${p.path}`} defaultValue={config.pages[p.path]} aria-label={p.label}>
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {name(t)} and up
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>

        <s-section heading="What the plans page lists">
          <s-paragraph>One line each, shown under the plan&rsquo;s price. The limits above are added at the top by themselves.</s-paragraph>
          <div className="sw-pk-lists">
            {TIERS.map((t) => (
              <label key={t}>
                <strong>{name(t)}</strong>
                <textarea name={`includes.${t}`} rows={9} defaultValue={config.includes[t].join("\n")} />
              </label>
            ))}
          </div>
          <s-paragraph>Prices aren’t changed here: Shopify and Stripe charge from them, so a new price needs a change to the app itself.</s-paragraph>
        </s-section>

        <div className="sw-pk-save">
          <s-button type="submit" variant="primary" disabled={busy}>
            Save packages
          </s-button>
        </div>
      </Form>
      <Form method="post" className="sw-pk-reset">
        <input type="hidden" name="intent" value="reset" />
        <s-button type="submit" variant="tertiary" disabled={busy}>
          Put every package back to how it started
        </s-button>
      </Form>

      <s-section heading={`Limits for one customer (${customers.length})`}>
        <s-paragraph>Give one customer more (or fewer) than their plan. Leave a box empty to follow their plan; the grey number is what their plan gives.</s-paragraph>
        <table className="sw-pk sw-pk-customers">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              {LIMITS.map((l) => (
                <th key={l.key}>{l.label}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.shop}>
                <td>
                  <strong>{c.name}</strong>
                  <span>
                    {c.kind} · {c.detail}
                  </span>
                </td>
                <td>{c.tier ? name(c.tier) : "None yet"}</td>
                {LIMITS.map((l) => (
                  <td key={l.key}>
                    <input
                      form={`c-${c.shop}`}
                      type="number"
                      min={0}
                      max={10000}
                      name={l.key}
                      defaultValue={c.own[l.key] ?? ""}
                      placeholder={String(config.limits[c.tier ?? "watch"][l.key])}
                      aria-label={`${l.label} for ${c.name}`}
                    />
                  </td>
                ))}
                <td>
                  <Form method="post" id={`c-${c.shop}`}>
                    <input type="hidden" name="intent" value="customer" />
                    <input type="hidden" name="shop" value={c.shop} />
                    <s-button type="submit" disabled={busy}>
                      Save
                    </s-button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}

const CSS = `
.sw-pk{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
.sw-pk th{text-align:left;font-weight:600;color:#5b6478;padding:8px 10px;border-bottom:1px solid #e7e9f2}
.sw-pk td{padding:8px 10px;border-bottom:1px solid #f0f1f6;vertical-align:middle}
.sw-pk td span{display:block;color:#8a91a5;font-size:12px}
.sw-pk input,.sw-pk select,.sw-pk-lists textarea{font:inherit;font-size:14px;padding:7px 10px;border:1px solid #d6d9e6;border-radius:9px;background:#fff;box-sizing:border-box}
.sw-pk input{width:110px}
.sw-pk-customers input{width:90px}
.sw-pk input:focus,.sw-pk select:focus,.sw-pk-lists textarea:focus{outline:none;border-color:var(--sw-accent,#6d5dfc);box-shadow:0 0 0 3px color-mix(in srgb,var(--sw-accent,#6d5dfc) 18%,transparent)}
.sw-pk-lists{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:12px 0}
.sw-pk-lists label{display:flex;flex-direction:column;gap:6px}
.sw-pk-lists textarea{width:100%;resize:vertical;line-height:1.5}
.sw-pk-save{display:flex;justify-content:flex-end;margin:16px 0 4px}
.sw-pk-reset{display:flex;justify-content:flex-end;margin-bottom:16px}
.sw-pk-customers{display:block;overflow-x:auto}
`;
