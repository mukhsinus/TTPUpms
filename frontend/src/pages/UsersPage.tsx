import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  api,
  type AdminSemesterScope,
  type AdminStudentDegree,
  type AdminStudentDetailPayload,
  type AdminStudentListItem,
} from "../lib/api";
import { onRealtimeUpdate } from "../lib/realtime-events";
import { normalizeStudentId } from "../lib/student-id";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";
import { TableSkeleton } from "../components/ui/PageSkeletons";

const PAGE_SIZE = 7;
const SEARCH_DEBOUNCE_MS = 300;

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function degreeLabel(v: AdminStudentDegree | null): string {
  if (v === "bachelor") return "Bachelor";
  if (v === "master") return "Master";
  return "—";
}

function validateStudentForm(input: {
  full_name: string;
  faculty: string;
  student_id: string;
}): string | null {
  const fullName = input.full_name.trim();
  if (!fullName) {
    return "Full name is required.";
  }
  if (fullName.length < 2 || fullName.length > 300) {
    return "Full name must be between 2 and 300 characters.";
  }
  const faculty = input.faculty.trim();
  if (!faculty) {
    return "Faculty is required.";
  }
  if (faculty.length > 200) {
    return "Faculty must be 200 characters or less.";
  }
  const studentId = normalizeStudentId(input.student_id);
  if (!studentId) {
    return "Student ID is required.";
  }
  if (studentId.length > 64) {
    return "Student ID is too long.";
  }
  return null;
}

export function UsersPage(): ReactElement {
  const { t: tSub } = useTranslation("submissions");
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [faculty, setFaculty] = useState("");
  const [degree, setDegree] = useState<"" | AdminStudentDegree>("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [semester, setSemester] = useState<AdminSemesterScope>("active");
  const [rows, setRows] = useState<AdminStudentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminStudentDetailPayload | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    degree: "bachelor" as AdminStudentDegree,
    faculty: "",
    student_id: "",
    email: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchInput.trim();
      setPage(1);
      setSearch(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getAdminStudents({
          page,
          pageSize: PAGE_SIZE,
          search: search || undefined,
          faculty: faculty.trim() || undefined,
          degree: degree || undefined,
          sort,
          semester,
        });
        if (!cancelled) {
          setRows(data.items);
          setTotal(data.pagination.total);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load students");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, search, faculty, degree, sort, semester]);

  useEffect(() => {
    return onRealtimeUpdate((event) => {
      if (event.type !== "new_student") return;
      void (async () => {
        try {
          const data = await api.getAdminStudents({
            page,
            pageSize: PAGE_SIZE,
            search: search || undefined,
            faculty: faculty.trim() || undefined,
            degree: degree || undefined,
            sort,
            semester,
            forceRefresh: true,
          });
          setRows(data.items);
          setTotal(data.pagination.total);
        } catch {
          // Silent realtime refresh.
        }
      })();
    });
  }, [page, search, faculty, degree, sort, semester]);

  useEffect(() => {
    if (!selectedStudentId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.getAdminStudentById(selectedStudentId, semester);
        if (!cancelled) {
          setSelected(data);
          setForm({
            full_name: data.fullName,
            degree: data.degree ?? "bachelor",
            faculty: data.faculty ?? "",
            student_id: data.studentId ?? "",
            email: data.email ?? "",
          });
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load student profile");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, semester, toast]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dirty = useMemo(() => {
    if (!selected) {
      return false;
    }
    return (
      selected.fullName !== form.full_name.trim() ||
      (selected.degree ?? "bachelor") !== form.degree ||
      (selected.faculty ?? "") !== form.faculty.trim() ||
      (selected.studentId ?? "") !== normalizeStudentId(form.student_id) ||
      (selected.email ?? "") !== form.email.trim()
    );
  }, [form, selected]);

  const saveDisabled =
    !selectedStudentId ||
    !dirty ||
    saving ||
    !form.full_name.trim() ||
    !form.faculty.trim() ||
    !form.student_id.trim();

  return (
    <section className="dashboard-stack">
      <Card>
        <div className="table-toolbar moderation-queue-toolbar">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by name, student ID, Telegram username"
          />
          <select
            className="ui-input"
            value={semester}
            onChange={(event) => {
              setPage(1);
              setSemester(event.target.value as AdminSemesterScope);
            }}
            aria-label={tSub("semesterCol")}
          >
            <option value="active">{tSub("filterSemesterActive")}</option>
            <option value="first">{tSub("filterSemesterFirst")}</option>
            <option value="second">{tSub("filterSemesterSecond")}</option>
            <option value="all">{tSub("filterSemesterAll")}</option>
          </select>
          <Input
            value={faculty}
            onChange={(event) => {
              setPage(1);
              setFaculty(event.target.value);
            }}
            placeholder="Filter by faculty"
          />
          <select
            className="ui-input"
            value={degree}
            onChange={(event) => {
              setPage(1);
              setDegree(event.target.value as "" | AdminStudentDegree);
            }}
            aria-label="Filter by degree"
          >
            <option value="">All degrees</option>
            <option value="bachelor">Bachelor</option>
            <option value="master">Master</option>
          </select>
          <select
            className="ui-input"
            value={sort}
            onChange={(event) => {
              setPage(1);
              setSort(event.target.value as "newest" | "oldest" | "name");
            }}
            aria-label="Sort order"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPage(1);
              setSearchInput("");
              setSearch("");
              setFaculty("");
              setDegree("");
              setSort("newest");
            }}
          >
            Clear
          </Button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={8} cols={10} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            tone="muted"
            title="No students found"
            description="Try changing your filters or search query."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Phone</th>
                  <th>Degree</th>
                  <th>Faculty</th>
                  <th>Student ID</th>
                  <th>Registered</th>
                  <th>Items</th>
                  <th>Score</th>
                  <th className="students-actions-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={selectedStudentId === row.id ? "clickable-row is-selected" : "clickable-row"}
                    onClick={() => setSelectedStudentId(row.id)}
                  >
                    <td>{row.fullName}</td>
                    <td>{row.phone ?? "—"}</td>
                    <td>{degreeLabel(row.degree)}</td>
                    <td>{row.faculty ?? "—"}</td>
                    <td>{row.studentId ?? "—"}</td>
                    <td>{formatDateOnly(row.registrationDate)}</td>
                    <td>{row.totalAchievementsSubmitted}</td>
                    <td>{row.totalApprovedScore.toFixed(2)}</td>
                    <td className="students-action-cell">
                      <div className="students-action-cell-inner">
                        <Button
                          type="button"
                          variant="ghost"
                          className="admin-review-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedStudentId(row.id);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="pagination-bar admin-pagination">
              <span className="muted">
                Page {page} of {totalPages} ({total} students)
              </span>
              <div className="pagination-actions admin-pagination-actions">
                <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {selected ? (
        <Card title="Student details">
          <div className="items-stack">
            <div className="row-between">
              <p className="muted">
                Telegram: @{selected.telegramUsername ?? "—"} · {selected.telegramId ?? "—"}
              </p>
              <p className="muted">
                Registered: {formatDate(selected.registrationDate)} · Last activity: {formatDate(selected.lastActivityAt)}
              </p>
            </div>
            <label className="item-review-field">
              <span>Name</span>
              <Input
                value={form.full_name}
                onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
              />
            </label>
            <label className="item-review-field">
              <span>Degree</span>
              <select
                className="ui-input"
                value={form.degree}
                onChange={(event) => setForm((prev) => ({ ...prev, degree: event.target.value as AdminStudentDegree }))}
              >
                <option value="bachelor">Bachelor</option>
                <option value="master">Master</option>
              </select>
            </label>
            <label className="item-review-field">
              <span>Faculty</span>
              <Input
                value={form.faculty}
                onChange={(event) => setForm((prev) => ({ ...prev, faculty: event.target.value }))}
              />
            </label>
            <label className="item-review-field">
              <span>Student ID</span>
              <Input
                value={form.student_id}
                onChange={(event) => setForm((prev) => ({ ...prev, student_id: event.target.value }))}
              />
            </label>
            <label className="item-review-field">
              <span>Email (optional)</span>
              <Input
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <div className="row-between">
              <p className="muted">Total submissions: {selected.totalSubmissions} · Items: {selected.totalAchievementsSubmitted}</p>
              <p className="muted">
                Profile completed: {selected.isProfileCompleted ? "Yes" : "No"} · Approved score: {selected.totalApprovedScore.toFixed(2)}
              </p>
            </div>
            <div className="actions-wrap">
              <Button
                type="button"
                variant="primary"
                disabled={saveDisabled}
                onClick={async () => {
                  if (!selectedStudentId) {
                    return;
                  }
                  const validationError = validateStudentForm(form);
                  if (validationError) {
                    toast.error(validationError);
                    return;
                  }
                  try {
                    setSaving(true);
                    const updated = await api.updateAdminStudent(selectedStudentId, {
                      full_name: form.full_name.trim(),
                      degree: form.degree,
                      faculty: form.faculty.trim(),
                      student_id: normalizeStudentId(form.student_id),
                      email: form.email.trim() ? form.email.trim() : null,
                    });
                    setSelected(updated);
                    setForm({
                      full_name: updated.fullName,
                      degree: updated.degree ?? "bachelor",
                      faculty: updated.faculty ?? "",
                      student_id: updated.studentId ?? "",
                      email: updated.email ?? "",
                    });
                    setRows((prev) =>
                      prev.map((row) =>
                        row.id === updated.id
                          ? {
                              ...row,
                              fullName: updated.fullName,
                              degree: updated.degree,
                              faculty: updated.faculty,
                              studentId: updated.studentId,
                            }
                          : row,
                      ),
                    );
                    toast.success("Student profile updated");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Update failed");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving..." : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving || !dirty}
                onClick={() => {
                  setForm({
                    full_name: selected.fullName,
                    degree: selected.degree ?? "bachelor",
                    faculty: selected.faculty ?? "",
                    student_id: selected.studentId ?? "",
                    email: selected.email ?? "",
                  });
                }}
              >
                Cancel changes
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelectedStudentId(null)}>
                Close
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </section>
  );
}
