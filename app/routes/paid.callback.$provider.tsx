import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ConnectResult } from "../components/ConnectResult";
import { readState } from "../lib/social/seal.server";
import { adminUrl } from "../lib/email/send.server";
import { connectMetaAds, connectTikTokAds } from "../lib/paidsocial/networks.server";
import { saveAdAccounts } from "../lib/paidsocial/paid.server";

// Where Meta and TikTok send the merchant back after they allow SimilarWise
// to manage their ad accounts. Opened in its own tab, since neither sign-in
// page works inside Shopify's admin.

const result = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const provider = params.provider;
  const state = readState(url.searchParams.get("state") ?? "");
  // TikTok for Business sends auth_code; Meta sends code.
  const code = url.searchParams.get("auth_code") ?? url.searchParams.get("code");
  if (!state || (provider !== "meta" && provider !== "tiktok") || state.network !== `${provider}-ads`)
    return { ok: false as const, message: "This sign-in link has expired. Go back to SimilarWise and press Connect again." };
  if (!code) return { ok: false as const, message: "You didn't finish signing in, so nothing was connected. You can try again from SimilarWise." };
  try {
    const accounts = provider === "meta" ? await connectMetaAds(code) : await connectTikTokAds(code);
    if (!(await saveAdAccounts(state.shop, accounts)))
      return {
        ok: false as const,
        message:
          provider === "meta"
            ? "No ad accounts came through. Make sure you picked your shop's ad account when signing in, and that you can manage its campaigns."
            : "No TikTok ad accounts came through. Make sure you ticked your advertiser account when signing in.",
      };
    return { ok: true as const, message: `Connected ${accounts.map((a) => a.name).join(", ")}.` };
  } catch (err) {
    console.error("Ad account sign-in failed", provider, state.shop, err);
    return { ok: false as const, message: `Not connected. ${err instanceof Error ? err.message : String(err)}` };
  }
};


// Where "Back to SimilarWise" goes when this tab can't just close.
export const loader = async (args: LoaderFunctionArgs) => {
  const state = readState(new URL(args.request.url).searchParams.get("state") ?? "");
  return { ...(await result(args)), back: state ? adminUrl(state.shop, "/app/paid-social") : null };
};

export default function PaidCallback() {
  const { ok, message, back } = useLoaderData<typeof loader>();
  return <ConnectResult ok={ok} heading={ok ? "Connected" : "Not connected"} message={message} back={back} />;
}
