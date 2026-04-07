import type { ReactElement } from "react";
import { Card } from "../components/ui/Card";

export function UsersPage(): ReactElement {
  return (
    <section className="dashboard-stack">
      <Card title="Users Management">
        <p className="error">
          This feature is disabled because backend endpoint <code>/api/admin/users</code> does not exist.
        </p>
        <p className="muted">Enable the backend endpoint before wiring this page back to live data.</p>
      </Card>
    </section>
  );
}
