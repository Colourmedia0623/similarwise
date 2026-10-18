import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { NETWORK_NAME } from "../lib/social/networks";
import { authorizeUrl, providerOn, type Provider } from "../lib/social/networks.server";
import { signState } from "../lib/social/seal.server";
import { disconnectAccount, setSocialAuto, socialAccounts } from "../lib/social/social.server";

// Social accounts: the Facebook Pages, Instagram business accounts and TikTok
// accounts blog articles can be shared to.

const SIGN_IN_FOR = 30 * 60_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const link = (p: Provider) => (providerOn(p) ? authorizeUrl(p, signState({ shop, network: p, exp: Date.now() + SIGN_IN_FOR })) : null);
  const [accounts, settings] = await Promise.all([socialAccounts(shop), db.shopSettings.findUnique({ where: { shop } })]);
  return { accounts, auto: settings?.socialAuto ?? false, meta: link("meta"), tiktok: link("tiktok") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "auto") await setSocialAuto(session.shop, form.get("on") === "true");
  if (intent === "disconnect") await disconnectAccount(session.shop, String(form.get("id") ?? ""));
  return { ok: true };
};

export default function Social() {
  const { accounts, auto, meta, tiktok } = useLoaderData<typeof loader>();
  const act = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const autoOn = act.formData?.get("intent") === "auto" ? act.formData.get("on") === "true" : auto;

  // Signing in happens in another tab; pick up the new accounts on coming back.
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && revalidator.revalidate();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [revalidator]);

  return (
    <s-page heading="Social accounts">
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Connect your shop&apos;s Facebook Page, Instagram and TikTok to share your blog articles there, each with a caption written for that
            network, the article&apos;s picture and a link back to your blog. Signing in opens in a new tab.
          </s-paragraph>
          <s-stack direction="inline" gap="small">
            {meta ? (
              <s-button variant="primary" href={meta} target="_blank">
                Connect Facebook and Instagram
              </s-button>
            ) : (
              <s-button disabled>Facebook and Instagram aren&apos;t switched on yet</s-button>
            )}
            {tiktok ? (
              <s-button href={tiktok} target="_blank">
                Connect TikTok
              </s-button>
            ) : (
              <s-button disabled>TikTok isn&apos;t switched on yet</s-button>
            )}
          </s-stack>
          <s-text color="subdued">
            Instagram needs a business or creator account linked to your Facebook Page. Signing in to Facebook connects both.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Connected">
        {accounts.length === 0 ? (
          <s-paragraph>Nothing connected yet.</s-paragraph>
        ) : (
          <s-stack gap="small">
            {accounts.map((a) => (
              <s-stack key={a.id} direction="inline" gap="small" alignItems="center">
                <s-badge tone={a.network === "facebook" ? "info" : a.network === "instagram" ? "warning" : "neutral"}>{NETWORK_NAME[a.network]}</s-badge>
                <s-text>{a.name}</s-text>
                <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "disconnect", id: a.id }, { method: "post" })}>
                  Disconnect
                </s-button>
              </s-stack>
            ))}
            <s-checkbox
              label="Share each content calendar article when it goes out"
              details="Posts to your Facebook and Instagram accounts above, with captions written for each. TikTok posts are always sent by you from the article's page, as TikTok asks."
              checked={autoOn}
              onChange={(e) => act.submit({ intent: "auto", on: String(e.currentTarget.checked) }, { method: "post" })}
            />
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
