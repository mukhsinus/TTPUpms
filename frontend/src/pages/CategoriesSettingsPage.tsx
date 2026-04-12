import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Tags } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { CategoriesTableSkeleton } from "../components/ui/PageSkeletons";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";
import type { Category, CategoryScoringType } from "../types";

export function CategoriesSettingsPage(): ReactElement {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<CategoryScoringType>("range");
  const [minScore, setMinScore] = useState("0");
  const [maxScore, setMaxScore] = useState("10");
  const [requiresReview, setRequiresReview] = useState(true);
  const [description, setDescription] = useState("");

  const load = async (): Promise<void> => {
    try {
      setLoading(true);
      setFetchError(null);
      setCategories(await api.getCategories());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const min = Number(minScore);
    const max = Number(maxScore);
    if (!name.trim() || Number.isNaN(min) || Number.isNaN(max) || min > max) {
      setFormError("Enter a valid name and score range (min ≤ max).");
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);
      const created = await api.createCategory({
        name: name.trim(),
        type,
        min_score: min,
        max_score: max,
        requires_review: requiresReview,
        description: description.trim() || undefined,
      });
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setDescription("");
      setMinScore("0");
      setMaxScore("10");
      setType("range");
      setRequiresReview(true);
      toast.success(`Category “${created.name}” created`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create category";
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="dashboard-stack">
      <Card title="Categories" subtitle="Evaluation categories and score ranges (admin)">
        {loading ? (
          <CategoriesTableSkeleton />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Score range</th>
                <th>Requires review</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-table-cell">
                    <div className="empty-state-in-card">
                      <EmptyState
                        icon={Tags}
                        tone={fetchError ? "danger" : "muted"}
                        title={fetchError ? "Couldn't load categories" : "No categories yet"}
                        description={
                          fetchError
                            ? fetchError
                            : "Create a category below or seed the database. Categories power scoring for submission items."
                        }
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                categories.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.type}</td>
                    <td>
                      {c.minScore} – {c.maxScore}
                    </td>
                    <td>{c.requiresReview ? "Yes" : "No"}</td>
                    <td>{new Date(c.createdAt).toLocaleDateString("en-US")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Create category" subtitle="New categories are available for submission items immediately.">
        {formError ? <p className="error categories-inline-error">{formError}</p> : null}
        <form className="auth-form" onSubmit={(event) => void handleCreate(event)}>
          <label>
            <span>Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. internal_competitions"
              required
            />
          </label>
          <label>
            <span>Type</span>
            <select className="ui-input" value={type} onChange={(event) => setType(event.target.value as CategoryScoringType)}>
              <option value="fixed">fixed</option>
              <option value="range">range</option>
              <option value="manual">manual</option>
            </select>
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
            }}
          >
            <label>
              <span>Min score</span>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={minScore}
                onChange={(event) => setMinScore(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Max score</span>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={maxScore}
                onChange={(event) => setMaxScore(event.target.value)}
                required
              />
            </label>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={requiresReview}
              onChange={(event) => setRequiresReview(event.target.checked)}
            />
            <span>Requires review</span>
          </label>
          <label>
            <span>Description (optional)</span>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Shown in scoring configuration"
            />
          </label>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create category"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
