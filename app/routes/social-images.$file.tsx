import type { LoaderFunctionArgs } from "react-router";
import { tiktokCopy } from "../lib/ideas/images.server";
import { instagramCopy, socialImage } from "../lib/social/publishing.server";

// Pictures for social calendar posts, public so Facebook, Instagram and
// TikTok can fetch them when a post goes out, and so the calendar can show
// them. /social-images/<id>.jpg, with ?for=instagram or ?for=tiktok for a
// copy that network accepts.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = /^([a-z0-9]+)\.jpg$/i.exec(params.file ?? "")?.[1];
  const image = id ? await socialImage(id) : null;
  if (!image) return new Response("Not found", { status: 404 });
  const forNetwork = new URL(request.url).searchParams.get("for");
  const data = new Uint8Array(image.data);
  const body =
    forNetwork === "tiktok" ? new Uint8Array(await tiktokCopy(data)) : forNetwork === "instagram" ? await instagramCopy(data, image.width, image.height) : data;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
      ETag: `"${image.id}-${forNetwork ?? ""}"`,
    },
  });
};
