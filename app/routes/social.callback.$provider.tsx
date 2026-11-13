import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { readState } from "../lib/social/seal.server";
import { connectMeta, connectPinterest, connectTikTok } from "../lib/social/networks.server";
import { saveAccounts } from "../lib/social/social.server";
import { connectCanva } from "../lib/social/canva.server";

// Where Meta, TikTok and Pinterest send the merchant back after they sign in. Opened in
// its own tab, since neither sign-in page works inside Shopify's admin.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const provider = params.provider;
  const rawState = url.searchParams.get("state") ?? "";
  const state = readState(rawState);
  const code = url.searchParams.get("code");
  // Canva is for designing pictures, not an account to post to.
  if (provider === "canva") {
    if (!state || state.network !== "canva") return { ok: false as const, message: "This sign-in link has expired. Go back to SimilarWise and press Connect Canva again." };
    if (!code) return { ok: false as const, message: "You didn't finish signing in, so Canva wasn't connected. You can try again from SimilarWise." };
    try {
      return { ok: true as const, message: `Connected Canva (${await connectCanva(state.shop, code, rawState)}). Back in SimilarWise, you can design a post's pictures in Canva.` };
    } catch (err) {
      console.error("Canva sign-in failed", state.shop, err);
      return { ok: false as const, message: `Canva wasn't connected. ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (!state || (provider !== "meta" && provider !== "tiktok" && provider !== "pinterest") || state.network !== provider)
    return { ok: false as const, message: "This sign-in link has expired. Go back to SimilarWise and press Connect again." };
  if (!code) return { ok: false as const, message: "You didn't finish signing in, so nothing was connected. You can try again from SimilarWise." };
  try {
    const accounts = provider === "meta" ? await connectMeta(code) : provider === "pinterest" ? await connectPinterest(code) : await connectTikTok(code);
    const count = await saveAccounts(state.shop, accounts);
    if (!count)
      return {
        ok: false as const,
        message:
          provider === "meta"
            ? "No Facebook Pages came through. Make sure you picked your shop's Page when signing in, and that its Instagram is a business account linked to the Page."
            : provider === "pinterest"
              ? "No Pinterest boards came through. Make a board on Pinterest, then connect again."
              : "No TikTok account came through. Try connecting again.",
      };
    return { ok: true as const, message: `Connected ${accounts.map((a) => a.name).join(", ")}.` };
  } catch (err) {
    console.error("Social sign-in failed", provider, state.shop, err);
    return { ok: false as const, message: `Not connected. ${err instanceof Error ? err.message : String(err)}` };
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
