import type { ReactElement } from "react";

export function PageLoading(): ReactElement {
  return (
    <div className="auth-page">
      <p className="muted">Loading…</p>
    </div>
  );
}
