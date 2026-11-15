import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { HOW_TOS, videoLength } from "../lib/help";

// Every how-to video, one per section, in menu order.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Help() {
  return (
    <s-page heading="Help videos">
      <s-section>
        <s-paragraph>A short video for each part of SimilarWise, showing what it does and how to use it. Each page also has a Watch how-to button.</s-paragraph>
      </s-section>
      <style>{CSS}</style>
      <div className="sw-videos">
        {HOW_TOS.map((h) => (
          <Link key={h.slug} to={`/app/help/${h.slug}`} className="sw-video">
            <span className="sw-video-thumb">
              <img src={`/how-to/${h.slug}.jpg`} alt="" loading="lazy" />
              <span className="sw-video-play" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z" />
                </svg>
              </span>
              <span className="sw-video-length">{videoLength(h.seconds)}</span>
            </span>
            <span className="sw-video-text">
              <strong>{h.title}</strong>
              <span>{h.section}</span>
            </span>
          </Link>
        ))}
      </div>
    </s-page>
  );
}

const CSS = `
.sw-videos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:16px}
.sw-video{display:flex;flex-direction:column;background:#fff;border:1px solid #e7e9f2;border-radius:16px;overflow:hidden;text-decoration:none;color:#0b1020;transition:transform .15s ease,box-shadow .15s ease}
.sw-video:hover{transform:translateY(-2px);box-shadow:0 14px 30px -18px rgba(15,20,40,.45)}
.sw-video-thumb{position:relative;display:block;aspect-ratio:16/9;background:#0b1020;overflow:hidden}
.sw-video-thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s ease}
.sw-video:hover .sw-video-thumb img{transform:scale(1.03)}
.sw-video-play{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;display:grid;place-items:center;color:var(--sw-ink,#fff);background:var(--sw-grad,linear-gradient(135deg,#6d5dfc,#2f7bff 55%,#22c1ee));box-shadow:0 8px 22px rgba(11,16,32,.35);opacity:.92;transition:transform .15s ease,opacity .15s}
.sw-video:hover .sw-video-play{transform:scale(1.08);opacity:1}
.sw-video-length{position:absolute;right:10px;bottom:10px;background:rgba(11,16,32,.78);color:#fff;font-size:12px;font-weight:600;padding:3px 8px;border-radius:6px;font-variant-numeric:tabular-nums}
.sw-video-text{display:flex;flex-direction:column;gap:3px;padding:12px 14px 14px}
.sw-video-text strong{font-size:15px;font-weight:650;line-height:1.3}
.sw-video-text span{font-size:13px;color:#5b6478}
@media (max-width:1000px){.sw-videos{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.sw-videos{grid-template-columns:1fr}}
`;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
