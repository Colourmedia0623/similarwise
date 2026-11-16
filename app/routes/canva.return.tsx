import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ConnectResult } from "../components/ConnectResult";
import { finishCanvaReturn } from "../lib/social/canva.server";

// Where Canva's "Back to SimilarWise" button lands. It brings the design's
// pages in as pictures for the post that started it, then closes this tab,
// leaving the merchant on the composer, which picks the pictures up.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const jwt = new URL(request.url).searchParams.get("correlation_jwt") ?? "";
  if (!jwt) return { ok: false as const, message: "Canva didn't say which design this was. Go back to SimilarWise and press Add from Canva instead." };
  const res = await finishCanvaReturn(jwt);
  if ("error" in res) return { ok: false as const, message: res.error };
  if ("article" in res && res.article) return { ok: true as const, message: "Your design is in SimilarWise as the article's picture." };
  return { ok: true as const, message: `Your design is in SimilarWise: ${res.pages} ${res.pages === 1 ? "picture" : "pictures"} added to your post.` };
};


export default function CanvaReturn() {
  const { ok, message } = useLoaderData<typeof loader>();
  return <ConnectResult ok={ok} heading={ok ? "Design added" : "Not added"} message={message} closeAfter={1500} />;
}
