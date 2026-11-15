import { useEffect, useState } from "react";

// The page a sign-in tab (Google, Meta, TikTok, Canva…) ends on, with a button
// back to SimilarWise. The tab was opened from SimilarWise, so the button
// brings that tab forward and closes this one; when the browser won't let it
// close, it opens SimilarWise here instead.

export function ConnectResult({
  ok,
  heading,
  message,
  back,
  closeAfter,
}: {
  ok: boolean;
  heading: string;
  message?: string;
  back?: string | null;
  closeAfter?: number;
}) {
  const [busy, setBusy] = useState(false);
  const goBack = () => {
    setBusy(true);
    try {
      window.opener?.focus();
    } catch {
      // A different site's page; it can't be brought forward.
    }
    if (window.opener) window.close();
    // Still open: closing wasn't allowed, or there's no SimilarWise tab behind it.
    setTimeout(() => window.location.assign(back || "/app"), 250);
  };
  useEffect(() => {
    if (!closeAfter || !ok) return;
    const t = setTimeout(() => window.close(), closeAfter);
    return () => clearTimeout(t);
  }, [ok, closeAfter]);
  return (
    <main style={page}>
      <style>{CSS}</style>
      <div className="cr-card">
        <span
          className={`cr-mark ${ok ? "cr-ok" : "cr-no"}`}
          aria-hidden="true"
        >
          {ok ? "✓" : "!"}
        </span>
        <h1>{heading}</h1>
        <p>{message}</p>
        <button
          type="button"
          className="cr-back"
          onClick={goBack}
          disabled={busy}
        >
          <span aria-hidden="true">←</span> Back to SimilarWise
        </button>
        <p className="cr-note">
          Or close this tab: SimilarWise is still open in the tab you came from.
        </p>
      </div>
    </main>
  );
}

const page = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px 16px",
  boxSizing: "border-box" as const,
  background: "#f5f6fb",
  fontFamily: "system-ui, -apple-system, sans-serif",
  lineHeight: 1.5,
  color: "#0b1020",
};

const CSS = `
body{margin:0}
.cr-card{max-width:480px;width:100%;background:#fff;border:1px solid #e7e9f2;border-radius:20px;padding:32px;box-shadow:0 12px 40px rgba(11,16,32,.08);text-align:center}
.cr-card h1{font-size:24px;margin:14px 0 8px}
.cr-card p{margin:0 0 20px;color:#3d4458}
.cr-mark{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:50%;font-size:26px;font-weight:700}
.cr-ok{background:#e3f5ec;color:#1f8a5b}
.cr-no{background:#fdecec;color:#c62828}
.cr-back{font:inherit;font-weight:600;font-size:15px;color:#fff;background:linear-gradient(135deg,#6d5dfc,#2f7bff);border:0;border-radius:12px;padding:12px 22px;cursor:pointer;display:inline-flex;gap:8px;align-items:center}
.cr-back:hover{filter:brightness(1.06)}
.cr-back:disabled{opacity:.7;cursor:default}
.cr-card .cr-note{margin:14px 0 0;font-size:13px;color:#8a91a5}
`;
