import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { NETWORK_NAME } from "../lib/social/networks";
import { authorizeUrl, providerApproved, providerOn, type Provider } from "../lib/social/networks.server";
import { isFreeShop } from "../lib/waitlist.server";
import { inboxOpen } from "../lib/inbox/inbox.server";
import { signState } from "../lib/social/seal.server";
import { canvaAccount, canvaAuthorizeUrl, canvaOn, disconnectCanva } from "../lib/social/canva.server";
import { createPinterestBoard, disconnectAccount, setSocialAuto, socialAccounts } from "../lib/social/social.server";
import { HowTo } from "../components/HowTo";

// Social accounts: the Facebook Pages, Instagram business accounts, TikTok
// accounts, Pinterest boards and LinkedIn profiles that posts and blog articles can be shared to.

const SIGN_IN_FOR = 30 * 60_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const open = (p: Provider) => providerOn(p) && (providerApproved(p) || isFreeShop(shop));
  // Where the social inbox is open, signing in also asks to read and answer comments and messages.
  const inbox = (p: Provider) => (p === "meta" ? inboxOpen(shop, "facebook") || inboxOpen(shop, "instagram") : inboxOpen(shop, p));
  const link = (p: Provider) => (open(p) ? authorizeUrl(p, signState({ shop, network: p, exp: Date.now() + SIGN_IN_FOR }), { inbox: inbox(p) }) : null);
  const [accounts, settings, canvaUser] = await Promise.all([socialAccounts(shop), db.shopSettings.findUnique({ where: { shop } }), canvaAccount(shop)]);
  return {
    accounts,
    auto: settings?.socialAuto ?? false,
    meta: link("meta"),
    tiktok: link("tiktok"),
    pinterest: link("pinterest"),
    linkedin: link("linkedin"),
    canva: canvaOn() ? { connect: canvaAuthorizeUrl(shop), name: canvaUser?.name ?? null } : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "auto") await setSocialAuto(session.shop, form.get("on") === "true");
  if (intent === "disconnect") await disconnectAccount(session.shop, String(form.get("id") ?? ""));
  if (intent === "canva-off") await disconnectCanva(session.shop);
  if (intent === "board") return { intent, ...(await createPinterestBoard(session.shop, String(form.get("name") ?? ""))) };
  return { ok: true };
};

export default function Social() {
  const { accounts, auto, meta, tiktok, pinterest, linkedin, canva } = useLoaderData<typeof loader>();
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
      <HowTo video="social-accounts" />
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Connect your shop&apos;s Facebook Page, Instagram, TikTok, Pinterest boards and LinkedIn profile to share your blog articles there, each with a caption written for that
            network, the article&apos;s picture and a link back to your blog. Signing in opens in a new tab.
          </s-paragraph>
          <s-stack direction="inline" gap="small">
            {meta ? (
              <s-button variant="primary" href={meta} target="_blank">
                Connect Facebook and Instagram
              </s-button>
            ) : (
              <s-button disabled>Facebook and Instagram coming soon</s-button>
            )}
            {tiktok ? (
              <s-button href={tiktok} target="_blank">
                Connect TikTok
              </s-button>
            ) : (
              <s-button disabled>TikTok coming soon</s-button>
            )}
            {pinterest ? (
              <s-button href={pinterest} target="_blank">
                Connect Pinterest
              </s-button>
            ) : (
              <s-button disabled>Pinterest coming soon</s-button>
            )}
            {linkedin ? (
              <s-button href={linkedin} target="_blank">
                Connect LinkedIn
              </s-button>
            ) : (
              <s-button disabled>LinkedIn coming soon</s-button>
            )}
          </s-stack>
          <s-text color="subdued">
            Instagram needs a business or creator account linked to your Facebook Page. Signing in to Facebook connects both. LinkedIn posts go to your own profile, and LinkedIn asks you to connect again every 60 days.
          </s-text>
          {(!meta || !tiktok || !pinterest || !linkedin) && (
            <s-text color="subdued">Sharing to the networks marked coming soon opens once they&apos;ve finished approving SimilarWise. We&apos;ll email you when it&apos;s ready.</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Connected">
        {accounts.length === 0 ? (
          <s-paragraph>Nothing connected yet.</s-paragraph>
        ) : (
          <s-stack gap="small">
            {accounts.map((a) => (
              <s-stack key={a.id} direction="inline" gap="small" alignItems="center">
                <s-badge tone={a.network === "facebook" ? "info" : a.network === "instagram" ? "warning" : a.network === "pinterest" ? "critical" : a.network === "linkedin" ? "success" : "neutral"}>{NETWORK_NAME[a.network]}</s-badge>
                <s-text>{a.name}</s-text>
                <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "disconnect", id: a.id }, { method: "post" })}>
                  Disconnect
                </s-button>
              </s-stack>
            ))}
            {accounts.some((a) => a.network === "pinterest") && <NewBoard />}
            <s-checkbox
              label="Share each content calendar article when it goes out"
              details="Posts to your Facebook, Instagram, Pinterest and LinkedIn accounts above, with captions written for each. TikTok posts are always sent by you from the article's page, as TikTok asks."
              checked={autoOn}
              onChange={(e) => act.submit({ intent: "auto", on: String(e.currentTarget.checked) }, { method: "post" })}
            />
          </s-stack>
        )}
      </s-section>

      {canva && (
        <s-section heading="Canva">
          <s-stack gap="small">
            <s-paragraph>Design a post&apos;s pictures in Canva from the social calendar, then bring the pages back into the post. Each page becomes one picture of a carousel.</s-paragraph>
            {canva.name ? (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone="success">Connected</s-badge>
                <s-text>{canva.name}</s-text>
                <s-button variant="tertiary" tone="critical" onClick={() => act.submit({ intent: "canva-off" }, { method: "post" })}>
                  Disconnect
                </s-button>
              </s-stack>
            ) : (
              <s-stack direction="inline">
                <s-button href={canva.connect} target="_blank">
                  Connect Canva
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

// Names and makes a new Pinterest board, which then shows above as an account to post to.
function NewBoard() {
  const make = useFetcher<typeof action>();
  const [name, setName] = useState("");
  const data = make.state === "idle" ? (make.data as { error?: string; name?: string } | undefined) : undefined;
  const [made, setMade] = useState<string | null>(null);
  if (data?.name && data.name !== made) {
    setMade(data.name);
    setName("");
  }
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small">
        <s-text type="strong">New Pinterest board</s-text>
        <s-stack direction="inline" gap="small" alignItems="end">
          <s-text-field label="Board name" value={name} placeholder="Autumn candles" maxLength={50} onInput={(e) => setName(e.currentTarget.value)} />
          <s-button loading={make.state !== "idle"} disabled={!name.trim()} onClick={() => make.submit({ intent: "board", name }, { method: "post" })}>
            Create board
          </s-button>
        </s-stack>
        <s-text color="subdued">Made as a public board on your Pinterest account, ready to pin to from the social calendar.</s-text>
        {data?.error && <s-banner tone="warning">{data.error}</s-banner>}
        {made && !data?.error && <s-banner tone="success">Made the board “{made}”.</s-banner>}
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
