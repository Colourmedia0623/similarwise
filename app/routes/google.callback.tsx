import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ConnectResult } from "../components/ConnectResult";
import { readState } from "../lib/social/seal.server";
import { adminUrl } from "../lib/email/send.server";
import { connectGoogle } from "../lib/google/google.server";

// Where Google sends the merchant back after they sign in. Opened in its own
// tab, since Google's sign-in page doesn't work inside Shopify's admin.

const result = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = readState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  if (!state || state.network !== "google") return { ok: false as const, message: "This sign-in link has expired. Go back to SimilarWise and press Connect Google again." };
  if (!code) return { ok: false as const, message: "You didn't finish signing in, so nothing was connected. You can try again from SimilarWise." };
  try {
    const email = await connectGoogle(state.shop, code);
    return { ok: true as const, message: `Connected ${email ?? "your Google account"}. Back in SimilarWise, choose which Analytics property and Google Ads account to show.` };
  } catch (err) {
    console.error("Google sign-in failed", state.shop, err);
    return { ok: false as const, message: `Not connected. ${err instanceof Error ? err.message : String(err)}` };
  }
};


// Where "Back to SimilarWise" goes when this tab can't just close.
export const loader = async (args: LoaderFunctionArgs) => {
  const state = readState(new URL(args.request.url).searchParams.get("state") ?? "");
  return { ...(await result(args)), back: state ? adminUrl(state.shop, "/app/google") : null };
};

export default function GoogleCallback() {
  const { ok, message, back } = useLoaderData<typeof loader>();
  return <ConnectResult ok={ok} heading={ok ? "Connected" : "Not connected"} message={message} back={back} />;
}
