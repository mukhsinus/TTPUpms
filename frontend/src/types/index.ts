export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "under_review"
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
}

export interface SubmissionItem {
  id: string;
  title: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  proposedScore: number;
  reviewerScore: number | null;
  reviewDecision: "approved" | "rejected" | null;
  reviewerComment: string | null;
  proofFileUrl?: string | null;
}

export interface User {
  id: string;
  email: string;
  fullName: string | null;
  role: "student" | "reviewer" | "admin";
  telegramUserId?: string | null;
}
