import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { howTo, videoLength } from "../lib/help";

// A "Watch how-to" button in a page's header. The video plays over the page,
// so closing it leaves the merchant where they were.
export function HowTo({ video }: { video: string }) {
  const h = howTo(video);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);
  if (!h) return null;
  return (
    <>
      <s-button slot="secondary-actions" icon="play-circle" onClick={() => setOpen(true)}>
        Watch how-to
      </s-button>
      {open &&
        createPortal(
          <div className="sw-howto" role="dialog" aria-modal="true" aria-label={`How to: ${h.title}`}>
            <style>{CSS}</style>
            <button type="button" className="sw-howto-scrim" tabIndex={-1} aria-label="Close video" onClick={() => setOpen(false)} />
            <div className="sw-howto-box">
              <div className="sw-howto-head">
                <strong>How to: {h.title}</strong>
                <span>{videoLength(h.seconds)}</span>
                <button type="button" className="sw-howto-close" onClick={() => setOpen(false)} aria-label="Close video" title="Close (Esc)">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <video key={h.slug} src={`/how-to/${h.slug}.mp4`} poster={`/how-to/${h.slug}.jpg`} controls autoPlay playsInline preload="metadata">
                <track kind="captions" />
              </video>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

const CSS = `
.sw-howto{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;background:rgba(11,16,32,.72);backdrop-filter:blur(4px);font-family:system-ui,-apple-system,sans-serif}
.sw-howto-scrim{position:absolute;inset:0;border:0;background:none;cursor:default}
.sw-howto-box{position:relative;width:min(960px,100%);background:#0b1020;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.sw-howto-head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 18px;color:#fff;font-size:15px}
.sw-howto-head span{color:#a3abc2;font-size:13px}
.sw-howto-close{margin-left:auto;display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:10px;background:rgba(255,255,255,.1);color:#fff;cursor:pointer}
.sw-howto-close:hover{background:rgba(255,255,255,.2)}
.sw-howto video{display:block;width:100%;aspect-ratio:16/9;background:#000}
`;
