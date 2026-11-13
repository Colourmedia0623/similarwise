import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { finishCanvaReturn } from "../lib/social/canva.server";

// Where Canva's "Back to SimilarWise" button lands. It brings the design's
// pages in as pictures for the post that started it, then closes this tab,
// leaving the merchant on the composer, which picks the pictures up.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const jwt = new URL(request.url).searchParams.get("correlation_jwt") ?? "";
  if (!jwt) return { ok: false as const, message: "Canva didn't say which design this was. Go back to SimilarWise and press Add from Canva instead." };
  const res = await finishCanvaReturn(jwt);
  if ("error" in res) return { ok: false as const, message: res.error };
  return { ok: true as const, message: `Your design is in SimilarWise: ${res.pages} ${res.pages === 1 ? "picture" : "pictures"} added to your post.` };
};

const page = { maxWidth: 520, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.5 };

export default function CanvaReturn() {
  const { ok, message } = useLoaderData<typeof loader>();
  // The tab was opened by SimilarWise, so it can close itself.
  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => window.close(), 1500);
    return () => clearTimeout(t);
  }, [ok]);
  return (
    <main style={page}>
      <h1>{ok ? "Design added" : "Not added"}</h1>
      <p>{message}</p>
      <p>You can close this tab and go back to SimilarWise.</p>
    </main>
  );
}
