export type CategoryScoringType = "fixed" | "range" | "manual";

export interface Category {
  id: string;
  name: string;
  type: CategoryScoringType;
  minScore: number;
  maxScore: number;
  requiresReview: boolean;
  createdAt: string;
}

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "review"
  | "approved"
  | "rejected"
  | "needs_revision";

export interface Submission {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  totalPoints: number;
  status: SubmissionStatus;
  createdAt?: string;
  updatedAt?: string;
  /** Set when the student submits for review. */
  submittedAt?: string | null;
  /** Set when the submission review is finalized (or terminal outcome recorded). */
  reviewedAt?: string | null;
  /** Present when API loads submission with JOIN to owner `users` row. */
  ownerStudentFullName?: string | null;
  ownerFaculty?: string | null;
  ownerStudentId?: string | null;
}

export type SubmissionItemStatus = "pending" | "approved" | "rejected";

export interface SubmissionItem {
  id: string;
  title: string;
  category: string;
  categoryId?: string | null;
  subcategory: string | null;
  subcategoryId?: string;
  metadata?: Record<string, unknown>;
  /** categories.type from API (fixed | range | expert | manual). */
  categoryType?: string;
  description: string | null;
  proposedScore: number | null;
  /** Workflow status (submission-items API). */
  status?: SubmissionItemStatus;
  approvedScore?: number | null;
  proofFileUrl?: string | null;
  externalLink?: string | null;
  reviewerComment?: string | null;
  createdAt?: string;
  /** Legacy fields when returned from reviews endpoints */
  reviewerScore?: number | null;
  reviewDecision?: "approved" | "rejected" | null;
}

export interface User {
  id: string;
  email: string;
  fullName: string | null;
  role: "student" | "reviewer" | "admin" | "superadmin";
  telegramUserId?: string | null;
}
