import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { readState } from "../lib/social/seal.server";
import { connectGoogle } from "../lib/google/google.server";

// Where Google sends the merchant back after they sign in. Opened in its own
// tab, since Google's sign-in page doesn't work inside Shopify's admin.

export const loader = async ({ request }: LoaderFunctionArgs) => {
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

const page = { maxWidth: 520, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.5 };

export default function GoogleCallback() {
  const { ok, message } = useLoaderData<typeof loader>();
  return (
    <main style={page}>
      <h1>{ok ? "Connected" : "Not connected"}</h1>
      <p>{message}</p>
      <p>You can close this tab and go back to SimilarWise.</p>
    </main>
  );
}
