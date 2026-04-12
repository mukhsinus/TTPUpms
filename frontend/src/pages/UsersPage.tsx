import type { ReactElement } from "react";
import { ServerCrash } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

export function UsersPage(): ReactElement {
  return (
    <section className="dashboard-stack">
      <Card title="Users">
        <EmptyState
          icon={ServerCrash}
          tone="muted"
          title="User management isn’t available"
          description="The backend endpoint /api/admin/users is not enabled yet. When it ships, you’ll manage roles and accounts from this screen."
        />
      </Card>
    </section>
  );
}
