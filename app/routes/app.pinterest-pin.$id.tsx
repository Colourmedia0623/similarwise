import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { shopPinterestPin } from "../lib/social/social.server";

// A pin as Pinterest has it. While the app has trial access its pins go to
// Pinterest's sandbox, which pinterest.com doesn't show, so "Open the post"
// comes here instead.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const found = await shopPinterestPin(session.shop, params.id ?? "");
  if (!found) throw new Response("Not found", { status: 404 });
  return found;
};

export default function PinterestPin() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Pinterest pin">
      <s-link slot="breadcrumb-actions" href="/app/publishing">
        Social calendar
      </s-link>
      <s-section>
        {"error" in data ? (
          <s-banner tone="critical">{data.error}</s-banner>
        ) : (
          <s-stack gap="base">
            <s-banner tone="info">{"This pin is in Pinterest's sandbox, where trial apps post, so it isn't on pinterest.com yet. Once Pinterest grants standard access, pins go live."}</s-banner>
            <s-stack direction="inline" gap="large">
              {data.pin.image && <img src={data.pin.image} alt="" style={{ width: 260, borderRadius: 16, display: "block" }} />}
              <s-stack gap="small">
                <s-heading>{data.pin.title || "Untitled pin"}</s-heading>
                <s-paragraph>{data.pin.description}</s-paragraph>
                {data.pin.link && (
                  <s-link href={data.pin.link} target="_blank">
                    {data.pin.link}
                  </s-link>
                )}
                <s-text color="subdued">
                  {data.board}, {new Date(data.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · Pin {data.pin.id}
                </s-text>
              </s-stack>
            </s-stack>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
