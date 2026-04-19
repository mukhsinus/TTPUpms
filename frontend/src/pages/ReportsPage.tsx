import { useMemo, useState, type ReactElement } from "react";
import { api } from "../lib/api";
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

export function ReportsPage(): ReactElement {
  const toast = useToast();
  const [from, setFrom] = useState(startOfDayIso(6).slice(0, 16));
  const [to, setTo] = useState(endOfDayIso().slice(0, 16));
  const [busy, setBusy] = useState<string | null>(null);

  const fromIso = useMemo(() => new Date(from).toISOString(), [from]);
  const toIso = useMemo(() => new Date(to).toISOString(), [to]);

  const exportCsv = async (
    kind: "moderation-performance" | "admin-productivity" | "approval-summary" | "audit-export",
    filename: string,
  ): Promise<void> => {
    try {
      setBusy(kind);
      const blob = await api.downloadReportCsv(kind, fromIso, toIso);
      downloadBlob(blob, filename);
      toast.success("Report exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="dashboard-stack">
      <Card title="Reports" subtitle="Download operational CSV exports for moderation and audit transparency.">
        <div className="row-between" style={{ gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="ghost" onClick={() => {
              setFrom(startOfDayIso(6).slice(0, 16));
              setTo(endOfDayIso().slice(0, 16));
            }}>
              Last 7d
            </Button>
            <Button type="button" variant="ghost" onClick={() => {
              setFrom(startOfDayIso(29).slice(0, 16));
              setTo(endOfDayIso().slice(0, 16));
            }}>
              Last 30d
            </Button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="stats-grid stats-grid-four">
          <Card title="Moderation Performance CSV">
            <p className="muted">Queue throughput and average review times by day.</p>
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null}
              onClick={() => void exportCsv("moderation-performance", "moderation-performance.csv")}
            >
              {busy === "moderation-performance" ? "Exporting..." : "Export CSV"}
            </Button>
          </Card>
          <Card title="Admin Productivity CSV">
            <p className="muted">Action volume, approvals, and rejects per admin.</p>
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null}
              onClick={() => void exportCsv("admin-productivity", "admin-productivity.csv")}
            >
              {busy === "admin-productivity" ? "Exporting..." : "Export CSV"}
            </Button>
          </Card>
          <Card title="Approval / Rejection Summary">
            <p className="muted">Status distribution summary for reviewed submissions.</p>
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null}
              onClick={() => void exportCsv("approval-summary", "approval-summary.csv")}
            >
              {busy === "approval-summary" ? "Exporting..." : "Export CSV"}
            </Button>
          </Card>
          <Card title="Audit Export CSV">
            <p className="muted">Immutable activity history for compliance checks.</p>
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null}
              onClick={() => void exportCsv("audit-export", "audit-export.csv")}
            >
              {busy === "audit-export" ? "Exporting..." : "Export CSV"}
            </Button>
          </Card>
        </div>
      </Card>
    </section>
  );
}
