import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { readState } from "../lib/social/seal.server";
import { connectMeta, connectTikTok } from "../lib/social/networks.server";
import { saveAccounts } from "../lib/social/social.server";

// Where Meta and TikTok send the merchant back after they sign in. Opened in
// its own tab, since neither sign-in page works inside Shopify's admin.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const provider = params.provider;
  const state = readState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  if (!state || (provider !== "meta" && provider !== "tiktok") || state.network !== provider)
    return { ok: false as const, message: "This sign-in link has expired. Go back to SimilarWise and press Connect again." };
  if (!code) return { ok: false as const, message: "You didn't finish signing in, so nothing was connected. You can try again from SimilarWise." };
  try {
    const accounts = provider === "meta" ? await connectMeta(code) : await connectTikTok(code);
    const count = await saveAccounts(state.shop, accounts);
    if (!count)
      return {
        ok: false as const,
        message:
          "No Facebook Pages came through. Make sure you picked your shop's Page when signing in, and that its Instagram is a business account linked to the Page.",
      };
    return { ok: true as const, message: `Connected ${accounts.map((a) => a.name).join(", ")}.` };
  } catch (err) {
    console.error("Social sign-in failed", provider, state.shop, err);
    return { ok: false as const, message: `Couldn't connect: ${err instanceof Error ? err.message : String(err)}` };
  }
};

const page = { maxWidth: 520, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.5 };

export default function SocialCallback() {
  const { ok, message } = useLoaderData<typeof loader>();
  return (
    <main style={page}>
      <h1>{ok ? "Connected" : "Not connected"}</h1>
      <p>{message}</p>
      <p>You can close this tab and go back to SimilarWise.</p>
    </main>
  );
}
