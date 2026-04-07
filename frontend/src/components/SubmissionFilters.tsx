import type { ReactElement } from "react";

interface SubmissionFiltersProps {
  status: string;
  search: string;
  onStatusChange: (status: string) => void;
  onSearchChange: (search: string) => void;
}

export function SubmissionFilters({
  status,
  search,
  onStatusChange,
  onSearchChange,
}: SubmissionFiltersProps): ReactElement {
  return (
    <section className="card">
      <h3>Filters</h3>
      <div className="filters">
        <input
          className="input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by title or user ID"
        />

        <select className="input" value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="">All statuses</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="needs_revision">Needs Revision</option>
          <option value="draft">Draft</option>
        </select>
      </div>
    </section>
  );
}
