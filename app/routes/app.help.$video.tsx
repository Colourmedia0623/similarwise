import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { howTo } from "../lib/help";

// One section's how-to video.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const h = howTo(params.video ?? "");
  if (!h) throw new Response("Not found", { status: 404 });
  return h;
};

export default function HelpVideo() {
  const h = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  // Back to the page they were on, or to the list when they came straight here.
  const close = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/app/help"));
  return (
    <s-page heading={`How to: ${h.title}`}>
      <s-link slot="breadcrumb-actions" href="/app/help">
        Help videos
      </s-link>
      <s-button slot="secondary-actions" icon="x" onClick={close}>
        Close
      </s-button>
      <s-button slot="primary-action" href={h.path}>
        Go to {h.section}
      </s-button>
      <s-section>
        <video
          key={h.slug}
          src={`/how-to/${h.slug}.mp4`}
          controls
          autoPlay
          playsInline
          preload="metadata"
          style={{ display: "block", width: "100%", aspectRatio: "16 / 9", borderRadius: 8, background: "#000" }}
        >
          <track kind="captions" />
        </video>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
