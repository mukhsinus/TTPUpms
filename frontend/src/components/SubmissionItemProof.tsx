import { memo, useEffect, useRef, useState, type ReactElement } from "react";

function proofKindFromUrl(url: string): "image" | "pdf" | "unknown" {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).toLowerCase();
    if (path.endsWith(".pdf")) return "pdf";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".png") || path.endsWith(".webp")) {
      return "image";
    }
    return "unknown";
  } catch {
    const path = url.split("?")[0]?.toLowerCase() ?? "";
    if (path.endsWith(".pdf")) return "pdf";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".png")) return "image";
    return "unknown";
  }
}

interface SubmissionItemProofProps {
  proofFileUrl: string;
}

/**
 * Proof preview: links always available; image/PDF heavy embeds load once the block is near the viewport
 * (saves bandwidth and main-thread work on long submission lists).
 */
export const SubmissionItemProof = memo(function SubmissionItemProof({
  proofFileUrl,
}: SubmissionItemProofProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showEmbed, setShowEmbed] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShowEmbed(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const kind = proofKindFromUrl(proofFileUrl);
  const wantsEmbed = kind === "image" || kind === "pdf";

  return (
    <div ref={rootRef} className="item-proof-block">
      <p className="muted item-proof-label">
        <strong>Proof</strong>
      </p>
      <div className="item-proof-actions">
        <a className="ui-link" href={proofFileUrl} target="_blank" rel="noopener noreferrer">
          Open in new tab
        </a>
        <a className="ui-link item-proof-download" href={proofFileUrl} download rel="noopener noreferrer">
          Download
        </a>
      </div>
      {wantsEmbed && !showEmbed ? (
        <p className="muted item-proof-fallback">Preview loads when this section is visible…</p>
      ) : null}
      {showEmbed && kind === "image" ? (
        <img
          src={proofFileUrl}
          alt=""
          className="item-proof-image"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
        />
      ) : null}
      {showEmbed && kind === "pdf" ? (
        <object
          className="item-proof-pdf"
          data={proofFileUrl}
          type="application/pdf"
          title="PDF preview"
        >
          <p className="muted item-proof-fallback">
            PDF preview is not available in this browser. Use open or download.
          </p>
        </object>
      ) : null}
      {kind === "unknown" ? (
        <p className="muted item-proof-fallback">Preview unavailable — use open or download.</p>
      ) : null}
    </div>
  );
});
