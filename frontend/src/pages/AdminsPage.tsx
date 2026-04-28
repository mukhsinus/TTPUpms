import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type SuperadminAdminListPayload } from "../lib/api";
import { onRealtimeUpdate } from "../lib/realtime-events";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { SearchAutocomplete, type SearchAutocompleteSuggestion } from "../components/ui/SearchAutocomplete";
import { Table } from "../components/ui/Table";

type AdminListItem = SuperadminAdminListPayload["items"][number];

export function AdminsPage(): ReactElement {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [list, setList] = useState<SuperadminAdminListPayload | null>(null);
  const currentUserId = api.getSessionUser()?.userId ?? null;

  const load = async (forceRefresh = false): Promise<void> => {
    setLoading(true);
    try {
      const data = await api.getSuperadminAdmins({ page, pageSize, search: search.trim() || undefined, forceRefresh });
      setList(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load admins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, pageSize, search]);

  useEffect(() => {
    return onRealtimeUpdate((event) => {
      if (event.type !== "new_admin") return;
      void load(true);
    });
  }, [page, pageSize, search]);

  const rows = list?.items ?? [];
  const pagination = list?.pagination;
  const fetchAdminSuggestions = useCallback(
    async (query: string): Promise<SearchAutocompleteSuggestion[]> => {
      const data = await api.getSuperadminAdmins({ page: 1, pageSize: 8, search: query });
      return data.items.map((item, index) => ({
        id: `${item.id}-${index}`,
        value: item.email ?? item.name ?? "",
        label: item.name ?? item.email ?? "Admin",
        meta: item.email ?? null,
      }));
    },
    [],
  );

  const runAction = async (adminId: string, action: () => Promise<void>, successMessage: string): Promise<void> => {
    try {
      setBusyId(adminId);
      await action();
      toast.success(successMessage);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="dashboard-stack">
      <Card className="admins-page-card">
        <div className="row-between admins-toolbar-row" style={{ gap: 12, marginBottom: 12 }}>
          <div className="admins-search-wrap" style={{ maxWidth: 340, width: "100%" }}>
            <SearchAutocomplete
              value={search}
              onChange={(next) => {
                setPage(1);
                setSearch(next);
              }}
              onSelect={(item) => {
                setPage(1);
                setSearch(item.value);
              }}
              fetchSuggestions={fetchAdminSuggestions}
              placeholder="Search by name or email"
              ariaLabel="Search by name or email"
            />
          </div>
        </div>
        <Table className="admins-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name ?? "—"}</td>
                <td>{row.email ?? "—"}</td>
                <td>
                  <span className="admin-status-pill">{row.status}</span>
                </td>
                <td>
                  <div className="admins-actions">
                    <Button
                      type="button"
                      variant="primary"
                      className="security-action-btn approve-btn"
                      disabled={
                        busyId === row.id ||
                        row.status === "active" ||
                        currentUserId === row.id
                      }
                      onClick={() => void runAction(row.id, () => api.setAdminStatus(row.id, "active"), "Admin enabled")}
                    >
                      Enable
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      className="security-action-btn reject-btn"
                      disabled={
                        busyId === row.id ||
                        row.status !== "active" ||
                        currentUserId === row.id
                      }
                      onClick={() =>
                        void runAction(row.id, () => api.setAdminStatus(row.id, "suspended", "Suspended by superadmin"), "Admin disabled")
                      }
                    >
                      Disable
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="row-between admins-pagination-row" style={{ marginTop: 12 }}>
          <span className="muted">
            {pagination ? `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} admins)` : "—"}
          </span>
          <div className="admins-pagination-actions" style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="ghost" disabled={!pagination?.hasPrev} onClick={() => setPage((v) => Math.max(1, v - 1))}>
              Prev
            </Button>
            <Button type="button" variant="ghost" disabled={!pagination?.hasNext} onClick={() => setPage((v) => v + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
