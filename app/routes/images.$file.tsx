import type { LoaderFunctionArgs } from "react-router";
import { articleImage } from "../lib/ideas/images.server";

// Blog article pictures, public so Shopify can fetch them when an article is
// sent, and so the app can show them. /images/<articleId>.jpg

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const id = /^([a-z0-9]+)\.jpg$/i.exec(params.file ?? "")?.[1];
  const image = id ? await articleImage(id) : null;
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mime,
      "Cache-Control": "public, max-age=3600",
      ETag: `"${image.createdAt.getTime()}"`,
    },
  });
};
