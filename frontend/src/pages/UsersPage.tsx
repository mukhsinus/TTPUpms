import { useEffect, useState, type ReactElement } from "react";
import { api } from "../lib/api";
import type { User } from "../types";

export function UsersPage(): ReactElement {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await api.getUsers();
        setUsers(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load users");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p>Loading users...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section className="stack">
      <article className="card">
        <h2>Users Management</h2>
        <p className="muted">
          This panel is ready. Once the users API endpoint is enabled, all admin actions can be wired here.
        </p>
      </article>

      <div className="stack">
        {users.length === 0 ? <p>No users returned by API.</p> : null}
        {users.map((user) => (
          <article className="card" key={user.id}>
            <div className="row-between">
              <h3>{user.fullName ?? user.email}</h3>
              <span className="status status-submitted">{user.role}</span>
            </div>
            <p className="muted">{user.email}</p>
            <p className="muted">Telegram: {user.telegramUserId ?? "-"}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
