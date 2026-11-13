import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { TikTokChoices, TikTokCreator } from "../lib/social/networks.server";

// The page using this answers the "tiktok" intent with tiktokAccount(),
// TikTok's account details read fresh for each post.
type TikTokAnswer = { creator?: TikTokCreator; error?: string };

// What TikTok's rules ask for before each post: the account it goes to,
// who can see it (no default), comments off until turned on, whether it
// promotes a brand, a preview, and TikTok's own terms. Nothing here is
// chosen for the merchant.
const PRIVACY: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};
const MUSIC = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRANDED = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export function TikTokPost({
  accountId,
  picture,
  caption,
  initial,
  onChange,
}: {
  accountId: string;
  picture: string | null;
  caption: string;
  initial?: TikTokChoices;
  onChange: (c: TikTokChoices | null) => void;
}) {
  const info = useFetcher<TikTokAnswer>();
  const [privacy, setPrivacy] = useState(initial?.privacy ?? "");
  const [allowComments, setAllowComments] = useState(initial?.allowComments ?? false);
  const [disclose, setDisclose] = useState(!!(initial?.yourBrand || initial?.brandedContent));
  const [yourBrand, setYourBrand] = useState(initial?.yourBrand ?? false);
  const [brandedContent, setBrandedContent] = useState(initial?.brandedContent ?? false);
  useEffect(() => {
    info.submit({ intent: "tiktok", accountId }, { method: "post" });
    // Read once when the account is picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);
  const data = info.state === "idle" ? info.data : undefined;
  const creator = data?.creator ?? null;
  const error = data?.error ?? null;
  const brandMissing = disclose && !yourBrand && !brandedContent;
  const privateBranded = brandedContent && privacy === "SELF_ONLY";
  const ready = !!creator && !!privacy && !brandMissing && !privateBranded;
  useEffect(() => {
    onChange(
      ready
        ? {
            privacy,
            allowComments: allowComments && !creator?.commentDisabled,
            yourBrand: disclose && yourBrand,
            brandedContent: disclose && brandedContent,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, privacy, allowComments, disclose, yourBrand, brandedContent]);

  if (error) return <s-banner tone="critical">{error}</s-banner>;
  if (!creator) return <s-text color="subdued">Checking your TikTok account…</s-text>;
  const label = brandedContent ? "Paid partnership" : yourBrand ? "Promotional content" : null;
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          {creator.avatar && <img style={{ width: 32, height: 32, borderRadius: "50%" }} src={creator.avatar} alt="" />}
          <s-text type="strong">Posting to TikTok as {creator.nickname || creator.username}</s-text>
          {creator.username && <s-text color="subdued">@{creator.username}</s-text>}
        </s-stack>
        {picture && (
          <s-stack direction="inline" gap="base">
            <img
              style={{
                width: 120,
                aspectRatio: "3 / 4",
                objectFit: "cover",
                borderRadius: 8,
              }}
              src={picture}
              alt="What the TikTok post will show"
            />
            <s-paragraph>{caption || "Write a caption above."}</s-paragraph>
          </s-stack>
        )}
        <s-select label="Who can see this post" value={privacy} onChange={(e) => setPrivacy(e.currentTarget.value)}>
          <s-option value="">Choose who can see it</s-option>
          {creator.privacyOptions.map((o) => (
            <s-option key={o} value={o} disabled={brandedContent && o === "SELF_ONLY"}>
              {PRIVACY[o] ?? o}
            </s-option>
          ))}
        </s-select>
        {privateBranded && <s-text tone="critical">Branded content can&apos;t be private. Choose who can see it.</s-text>}
        <s-checkbox
          label="Allow comments"
          checked={allowComments && !creator.commentDisabled}
          disabled={creator.commentDisabled}
          details={creator.commentDisabled ? "Comments are turned off in your TikTok settings." : undefined}
          onChange={(e) => setAllowComments(e.currentTarget.checked)}
        />
        <s-switch
          label="Disclose commercial content"
          checked={disclose}
          details="Turn on if this post promotes your shop, a product, or a brand that paid you."
          onChange={(e) => setDisclose(e.currentTarget.checked)}
        />
        {disclose && (
          <s-stack gap="small">
            <s-checkbox
              label="Your brand"
              details="You're promoting yourself or your own business."
              checked={yourBrand}
              onChange={(e) => setYourBrand(e.currentTarget.checked)}
            />
            <s-checkbox
              label="Branded content"
              details="You're promoting another brand or a third party."
              checked={brandedContent}
              onChange={(e) => setBrandedContent(e.currentTarget.checked)}
            />
            {brandMissing && <s-text tone="critical">Choose whether you&apos;re promoting your brand, another brand, or both.</s-text>}
            {label && <s-text color="subdued">Your photo will be labelled &quot;{label}&quot;.</s-text>}
          </s-stack>
        )}
        <s-text color="subdued">
          By posting, you agree to TikTok&apos;s{" "}
          {brandedContent && (
            <>
              <s-link href={BRANDED} target="_blank">
                Branded Content Policy
              </s-link>{" "}
              and{" "}
            </>
          )}
          <s-link href={MUSIC} target="_blank">
            Music Usage Confirmation
          </s-link>
          .
        </s-text>
      </s-stack>
    </s-box>
  );
}
