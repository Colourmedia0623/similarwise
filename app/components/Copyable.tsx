import { useState } from "react";

// A labelled piece of text with a Copy button, and a character count when
// there is a limit to keep under.
export function Copyable({ label, text, limit }: { label: string; text: string; limit?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-text color="subdued">
            {label}
            {limit != null && ` · ${text.length} of ${limit} characters`}
          </s-text>
          <s-button
            variant="tertiary"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </s-button>
        </s-stack>
        <s-text>{text}</s-text>
      </s-stack>
    </s-box>
  );
}
