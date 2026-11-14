import { howTo } from "../lib/help";

// A "Watch how-to" button in a page's header, opening that section's video.
export function HowTo({ video }: { video: string }) {
  const h = howTo(video);
  if (!h) return null;
  return (
    <s-button slot="secondary-actions" icon="play-circle" href={`/app/help/${h.slug}`}>
      Watch how-to
    </s-button>
  );
}
