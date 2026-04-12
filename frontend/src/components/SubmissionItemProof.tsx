import type { ReactElement } from "react";

function proofKindFromUrl(url: string): "image" | "pdf" | "unknown" {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".png")) return "image";
  return "unknown";
}

interface SubmissionItemProofProps {
  proofFileUrl: string;
}

export function SubmissionItemProof({ proofFileUrl }: SubmissionItemProofProps): ReactElement {
  const kind = proofKindFromUrl(proofFileUrl);

  return (
    <div className="item-proof-block">
      <p className="muted item-proof-label">
        <strong>Proof</strong>
      </p>
      <div className="item-proof-actions">
        <a className="ui-link" href={proofFileUrl} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
        <a className="ui-link item-proof-download" href={proofFileUrl} download>
          Download
        </a>
      </div>
      {kind === "image" ? (
        <img src={proofFileUrl} alt="" className="item-proof-image" loading="lazy" />
      ) : null}
      {kind === "pdf" ? (
        <iframe title="PDF preview" className="item-proof-pdf" src={proofFileUrl} />
      ) : null}
      {kind === "unknown" ? (
        <p className="muted item-proof-fallback">Preview unavailable — use open or download.</p>
      ) : null}
    </div>
  );
}
