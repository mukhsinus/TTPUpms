import type { Category, Submission, SubmissionItem, SubmissionStatus, User } from "../types";
import { signInWithSupabasePassword } from "./auth-sign-in";
import { ApiError } from "./api-error";
import { normalizeRole, type AppRole } from "./rbac";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? "";
const AUTH_TOKEN_KEY = "upms_admin_token";

export { ApiError };

interface ApiResponse<T> {
  data: T | null;
  error: {
    message: string;
    code: string;
  } | null;
}

export interface SessionUser {
  /** Supabase JWT `sub` — matches backend `user.id`. */
  userId: string | null;
  email: string | null;
  role: AppRole;
  fullName: string | null;
}

/** Response from POST /api/files/upload (and POST /files/upload). */
export interface FileUploadResult {
  id: string;
  fileUrl: string;
  mimeType: string;
  signedUrl: string;
  sizeBytes: number;
  originalFilename: string;
}

/** Item payload from PATCH /api/reviews/items/:itemId (and POST review item). */
export interface ReviewSubmissionItemResponse {
  id: string;
  submissionId: string;
  userId: string;
  category: string;
  subcategory: string | null;
  title: string;
  description: string | null;
  proposedScore: number;
  reviewerScore: number | null;
  approvedScore: number | null;
  reviewerComment: string | null;
  reviewDecision: "approved" | "rejected" | null;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TopStudent {
  userId: string;
  email: string;
  fullName: string | null;
  approvedPoints: number;
  approvedSubmissions: number;
}

interface ScoreByCategory {
  category: string;
  approvedPoints: number;
  approvedItems: number;
}

interface ActivityStat {
  status: string;
  count: number;
}

interface ApiResult<T> {
  data: T | null;
  error: string | null;
  statusCode: number;
}

function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
}

function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function parseUnknownResponseBody(rawText: string): unknown {
  if (!rawText.trim()) return null;
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requestResult<T>(path: string, init?: RequestInit, token?: string): Promise<ApiResult<T>> {
  const headers = new Headers(init?.headers);
  const authToken = token ?? getAuthToken();

  if (init?.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const rawText = await response.text();
  const parsed = parseUnknownResponseBody(rawText);
  const payload =
    parsed && typeof parsed === "object" ? (parsed as ApiResponse<T>) : null;

  const messageFromPayload =
    payload?.error?.message ?? (typeof parsed === "string" ? parsed : undefined);
  const fallbackMessage = response.statusText || "Request failed";
  const message = messageFromPayload || fallbackMessage;

  if (!response.ok || payload?.error) {
    if (response.status === 401) {
      return { data: null, error: "Unauthorized. Please login again.", statusCode: 401 };
    }
    if (response.status === 403) {
      return { data: null, error: "Forbidden. You do not have access to this action.", statusCode: 403 };
    }
    return { data: null, error: message, statusCode: response.status };
  }

  if (!payload || payload.error !== null) {
    return {
      data: null,
      error: "Invalid API response format",
      statusCode: response.status,
    };
  }

  return { data: payload.data as T, error: null, statusCode: response.status };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await requestResult<T>(path, init);
  if (result.error) {
    throw new ApiError(result.error, result.statusCode);
  }
  return result.data as T;
}

export const api = {
  isLoggedIn(): boolean {
    return Boolean(getAuthToken());
  },

  logout(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  },

  getSessionUser(): SessionUser | null {
    const token = getAuthToken();
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    if (!payload) return null;

    const appMetadata = (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
    const userMetadata = (payload.user_metadata as Record<string, unknown> | undefined) ?? {};

    const rawRole = typeof appMetadata.role === "string" ? appMetadata.role : "student";

    return {
      userId: typeof payload.sub === "string" ? payload.sub : null,
      email: typeof payload.email === "string" ? payload.email : null,
      role: normalizeRole(rawRole),
      fullName:
        typeof userMetadata.full_name === "string"
          ? userMetadata.full_name
          : typeof userMetadata.name === "string"
            ? userMetadata.name
            : null,
    };
  },

  async loginWithCredentials(email: string, password: string): Promise<void> {
    const token = await signInWithSupabasePassword(email, password);
    const result = await requestResult<Submission[]>("/api/submissions", { method: "GET" }, token);
    if (result.error) {
      throw new ApiError(result.error, result.statusCode);
    }

    setAuthToken(token);
  },

  async getDashboardStats(): Promise<{
    totalSubmissions: number;
    pendingReview: number;
    approved: number;
    rejected: number;
  }> {
    const submissions = await request<Submission[]>("/api/submissions");
    const pending = submissions.filter((item) => item.status === "submitted" || item.status === "under_review").length;
    const approved = submissions.filter((item) => item.status === "approved").length;
    const rejected = submissions.filter((item) => item.status === "rejected").length;

    return {
      totalSubmissions: submissions.length,
      pendingReview: pending,
      approved,
      rejected,
    };
  },

  getSubmissions(): Promise<Submission[]> {
    return request<Submission[]>("/api/submissions");
  },

  getSubmissionById(submissionId: string): Promise<Submission> {
    return request<Submission>(`/api/submissions/${submissionId}`);
  },

  getSubmissionItems(submissionId: string): Promise<SubmissionItem[]> {
    return request<SubmissionItem[]>(`/api/submission-items/${submissionId}`);
  },

  createSubmissionItem(input: {
    submission_id: string;
    category_id: string;
    subcategory?: string;
    title: string;
    description?: string;
    proof_file_url?: string;
    external_link?: string;
    proposed_score: number;
  }): Promise<SubmissionItem> {
    return request<SubmissionItem>("/api/submission-items", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  reviewSubmissionItem(input: {
    submissionId: string;
    itemId: string;
    score: number;
    comment?: string;
    decision: "approved" | "rejected";
  }): Promise<SubmissionItem> {
    return request<SubmissionItem>(`/api/reviews/submissions/${input.submissionId}/items/${input.itemId}`, {
      method: "POST",
      body: JSON.stringify({
        score: input.score,
        comment: input.comment,
        decision: input.decision,
      }),
    });
  },

  /** PATCH /api/reviews/items/:itemId — reviewer/admin; sets approved score, status, comment. */
  patchReviewItem(input: {
    itemId: string;
    approved_score: number;
    status: "approved" | "rejected";
    reviewer_comment?: string;
  }): Promise<ReviewSubmissionItemResponse> {
    return request<ReviewSubmissionItemResponse>(`/api/reviews/items/${input.itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        approved_score: input.approved_score,
        status: input.status,
        reviewer_comment: input.reviewer_comment,
      }),
    });
  },

  /** POST /api/reviews/submissions/:id/start-review — submitted → under_review. */
  startSubmissionReview(submissionId: string): Promise<Submission> {
    return request<Submission>(`/api/reviews/submissions/${submissionId}/start-review`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  /** POST /api/reviews/submissions/:id/finalize — alias of /complete; under_review → outcome. */
  finalizeSubmissionReview(input: {
    submissionId: string;
    decision: "approved" | "rejected" | "needs_revision";
    comment?: string;
  }): Promise<Submission> {
    return request<Submission>(`/api/reviews/submissions/${input.submissionId}/finalize`, {
      method: "POST",
      body: JSON.stringify({
        decision: input.decision,
        comment: input.comment,
      }),
    });
  },

  setSubmissionStatus(input: {
    submissionId: string;
    status: SubmissionStatus;
    reason?: string;
  }): Promise<Submission> {
    return request<Submission>(`/api/admin/submissions/${input.submissionId}/override-status`, {
      method: "PATCH",
      body: JSON.stringify({
        status: input.status,
        reason: input.reason,
      }),
    });
  },

  setSubmissionScore(input: { submissionId: string; totalScore: number; reason?: string }): Promise<Submission> {
    return request<Submission>(`/api/admin/submissions/${input.submissionId}/override-score`, {
      method: "PATCH",
      body: JSON.stringify({
        totalScore: input.totalScore,
        reason: input.reason,
      }),
    });
  },

  getUsers(): Promise<User[]> {
    // Backend does not provide /api/admin/users yet.
    throw new ApiError("Users endpoint is not available on backend", 501);
  },

  getTopStudents(limit = 8): Promise<TopStudent[]> {
    return request<TopStudent[]>(`/api/analytics/top-students?limit=${limit}`);
  },

  getScoresByCategory(): Promise<ScoreByCategory[]> {
    return request<ScoreByCategory[]>("/api/analytics/scores-by-category");
  },

  getActivityStats(): Promise<ActivityStat[]> {
    return request<ActivityStat[]>("/api/analytics/activity-stats");
  },

  getCategories(): Promise<Category[]> {
    return request<Category[]>("/api/categories");
  },

  createCategory(input: {
    name: string;
    type: Category["type"];
    min_score: number;
    max_score: number;
    requires_review?: boolean;
    description?: string;
  }): Promise<Category> {
    return request<Category>("/api/categories", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        type: input.type,
        min_score: input.min_score,
        max_score: input.max_score,
        requires_review: input.requires_review ?? true,
        description: input.description,
      }),
    });
  },

  /**
   * Multipart upload to Supabase Storage; updates `submission_items.proof_file_url` when `submissionItemId` is set.
   */
  uploadSubmissionItemProof(input: {
    submissionId: string;
    submissionItemId: string;
    file: File;
  }): Promise<FileUploadResult> {
    const form = new FormData();
    form.append("submissionId", input.submissionId);
    form.append("submissionItemId", input.submissionItemId);
    form.append("file", input.file, input.file.name);
    return request<FileUploadResult>("/api/files/upload", {
      method: "POST",
      body: form,
    });
  },
};
