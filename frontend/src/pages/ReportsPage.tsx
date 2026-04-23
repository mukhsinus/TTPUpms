import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { api, type SuperadminAdminListPayload } from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

function startOfDayIso(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function endOfDayIso(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const HIDDEN_REPORT_ADMIN_EMAIL = "kamolovmuhsin@icloud.com";

function toAdminOptionLabel(admin: SuperadminAdminListPayload["items"][number]): string {
  const name = admin.name?.trim() || "Unnamed admin";
  const email = admin.email?.trim() || "no-email";
  return `${name} (${email})`;
}

export function ReportsPage(): ReactElement {
  const toast = useToast();
  const [range, setRange] = useState<"today" | "last7" | "thisMonth" | "custom">("last7");
  const [from, setFrom] = useState(startOfDayIso(6).slice(0, 16));
  const [to, setTo] = useState(endOfDayIso().slice(0, 16));
  const [selectedAdminId, setSelectedAdminId] = useState("");
  const [admins, setAdmins] = useState<SuperadminAdminListPayload["items"]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingAdmins, setLoadingAdmins] = useState(false);

  const fromIso = useMemo(() => new Date(from).toISOString(), [from]);
  const toIso = useMemo(() => new Date(to).toISOString(), [to]);

  const loadAdmins = useCallback(async (): Promise<void> => {
    try {
      setLoadingAdmins(true);
      const pageSize = 100;
      let page = 1;
      let hasNext = true;
      const all: SuperadminAdminListPayload["items"] = [];
      while (hasNext) {
        const payload = await api.getSuperadminAdmins({ page, pageSize, forceRefresh: true });
        all.push(...payload.items);
        hasNext = payload.pagination.hasNext;
        page += 1;
      }
      const hiddenEmail = HIDDEN_REPORT_ADMIN_EMAIL.toLowerCase();
      const filtered = all.filter((admin) => (admin.email?.trim().toLowerCase() ?? "") !== hiddenEmail);
      setAdmins(filtered);
      setSelectedAdminId((prev) => (prev && !filtered.some((admin) => admin.id === prev) ? "" : prev));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load admins");
    } finally {
      setLoadingAdmins(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAdmins();
    const timer = window.setInterval(() => {
      void loadAdmins();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadAdmins]);

  const exportPdf = async (): Promise<void> => {
    try {
      setBusy(true);
      const blob = await api.downloadActivityReportPdf({
        range,
        from: range === "custom" ? fromIso : undefined,
        to: range === "custom" ? toIso : undefined,
        adminId: selectedAdminId || undefined,
      });
      downloadBlob(blob, "admin-activity-audit.pdf");
      toast.success("PDF report exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-stack">
      <Card title="Reports" subtitle="Export PDF audit report for business-critical admin actions.">
        <div className="row-between" style={{ gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div className="reports-range-filters" style={{ display: "flex", gap: 8 }}>
            <Button
              type="button"
              variant="ghost"
              className={`reports-range-toggle${range === "today" ? " is-selected" : ""}`}
              onClick={() => setRange("today")}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={`reports-range-toggle${range === "last7" ? " is-selected" : ""}`}
              onClick={() => setRange("last7")}
            >
              Last 7d
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={`reports-range-toggle${range === "thisMonth" ? " is-selected" : ""}`}
              onClick={() => setRange("thisMonth")}
            >
              This month
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={`reports-range-toggle${range === "custom" ? " is-selected" : ""}`}
              onClick={() => setRange("custom")}
            >
              Custom
            </Button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {range === "custom" ? (
              <>
                <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            ) : null}
            <select
              className="ui-input"
              value={selectedAdminId}
              onChange={(event) => setSelectedAdminId(event.target.value)}
              disabled={loadingAdmins || busy}
              aria-label="Admin filter"
            >
              <option value="">All admins</option>
              {admins.map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {toAdminOptionLabel(admin)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void exportPdf()}>
            {busy ? "Exporting..." : "Export PDF Report"}
          </Button>
        </div>
      </Card>
    </section>
  );
}
