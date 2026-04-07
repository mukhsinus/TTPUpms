import type { ReactElement } from "react";

export function UsersPage(): ReactElement {
  return (
    <section className="stack">
      <article className="card">
        <h2>Users Management</h2>
        <p className="error">
          This feature is disabled because backend endpoint <code>/api/admin/users</code> does not exist.
        </p>
        <p className="muted">Enable the backend endpoint before wiring this page back to live data.</p>
      </article>
    </section>
  );
}
