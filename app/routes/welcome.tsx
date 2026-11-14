import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { AuthPage, authStyles as s } from "../components/web/AuthPage";
import { createWorkspace, safeNext, webAccount } from "../lib/web/auth.server";
import { PLATFORMS, cleanWebsite } from "../lib/web/shop";
import { MARKETS } from "../lib/traffic/markets";

// Setting up a workspace: the store or business SimilarWise watches the
// competitors of. Shown after sign-up, and for adding another one (?new).

export const meta: MetaFunction = () => [{ title: "Set up your workspace · SimilarWise" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const account = await webAccount(request);
  if (!account) throw redirect(`/login?next=${encodeURIComponent("/welcome")}`);
  const adding = url.searchParams.has("new");
  if (account.workspace && !adding) throw redirect(safeNext(url.searchParams.get("next")));
  return { adding, first: account.workspaces.length === 0, name: account.user.name };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const account = await webAccount(request);
  if (!account) throw redirect("/login");
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const platform = String(form.get("platform") ?? "");
  const rawSite = String(form.get("website") ?? "");
  const website = cleanWebsite(rawSite);
  const country = MARKETS.find((m) => m.code === form.get("country"))?.code ?? null;
  if (!name) return { error: "Give your workspace a name, such as your store or company." };
  if (!PLATFORMS.some((p) => p.value === platform)) return { error: "Choose what your store runs on." };
  if (rawSite.trim() && !website) return { error: "That website doesn't look right. Enter it like yourstore.com." };
  if (!website && platform !== "none") return { error: "Enter your store's website, so SimilarWise can compare it with competitors." };
  await createWorkspace(account, { name, website, platform, country });
  throw redirect("/app");
};

export default function Welcome() {
  const { adding, first } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <AuthPage
      title={adding ? "Add a workspace" : "Set up your workspace"}
      lead={
        adding
          ? "Each workspace has its own competitors, keywords and social accounts. Agencies use one per client."
          : "Tell us about the store or business you want to grow. Agencies can add a workspace for each client later."
      }
    >
      <Form method="post" className={s.form}>
        {result?.error && <div className={s.error}>{result.error}</div>}
        <label className={s.field}>
          Workspace name
          <input name="name" placeholder="Gift Boxes Ltd" required />
        </label>
        <label className={s.field}>
          Your store runs on
          <select name="platform" defaultValue="" required>
            <option value="" disabled>
              Choose one
            </option>
            {[...PLATFORMS].map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          Website
          <input name="website" placeholder="yourstore.com" inputMode="url" autoComplete="url" />
          <span className={s.hint}>Leave empty if you don’t have a site of your own.</span>
        </label>
        <label className={s.field}>
          Main market
          <select name="country" defaultValue="GB">
            {MARKETS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
          <span className={s.hint}>Where your customers are, for search and traffic figures.</span>
        </label>
        <button className={s.primary} type="submit" disabled={busy}>
          {busy ? "Setting up…" : first ? "Start using SimilarWise" : "Add workspace"}
        </button>
      </Form>
      {adding && (
        <div className={s.links}>
          <a href="/app">Cancel</a>
        </div>
      )}
    </AuthPage>
  );
}
