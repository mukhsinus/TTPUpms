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
  const [range, setRange] = useState<"today" | "last7" | "thisMonth" | "custom">("last7");
  const [from, setFrom] = useState(startOfDayIso(6).slice(0, 16));
  const [to, setTo] = useState(endOfDayIso().slice(0, 16));
  const [adminId, setAdminId] = useState("");
  const [actionType, setActionType] = useState("");
  const [busy, setBusy] = useState(false);

  const fromIso = useMemo(() => new Date(from).toISOString(), [from]);
  const toIso = useMemo(() => new Date(to).toISOString(), [to]);

  const exportPdf = async (): Promise<void> => {
    try {
      setBusy(true);
      const blob = await api.downloadActivityReportPdf({
        range,
        from: range === "custom" ? fromIso : undefined,
        to: range === "custom" ? toIso : undefined,
        adminId: adminId.trim() || undefined,
        actionType: actionType.trim() || undefined,
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
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant={range === "today" ? "secondary" : "ghost"} onClick={() => setRange("today")}>
              Today
            </Button>
            <Button type="button" variant={range === "last7" ? "secondary" : "ghost"} onClick={() => setRange("last7")}>
              Last 7d
            </Button>
            <Button
              type="button"
              variant={range === "thisMonth" ? "secondary" : "ghost"}
              onClick={() => setRange("thisMonth")}
            >
              This month
            </Button>
            <Button type="button" variant={range === "custom" ? "secondary" : "ghost"} onClick={() => setRange("custom")}>
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
            <Input placeholder="Admin ID (optional)" value={adminId} onChange={(e) => setAdminId(e.target.value)} />
            <Input
              placeholder="Action type (optional)"
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
            />
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
