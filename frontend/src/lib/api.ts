import type { Submission, SubmissionItem, SubmissionStatus, User } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? "";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const AUTH_TOKEN_KEY = "upms_admin_token";

interface ApiResponse<T> {
  data: T | null;
  error: {
    message: string;
    code: string;
  } | null;
}

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = "ApiError";
  }
}

export interface SessionUser {
  email: string | null;
  role: string;
  fullName: string | null;
}

interface SupabaseAuthResponse {
  access_token?: string;
  user?: {
    email?: string;
    user_metadata?: {
      full_name?: string;
      name?: string;
    };
    app_metadata?: {
      role?: string;
    };
  };
  error_description?: string;
  msg?: string;
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

  if (init?.body && !headers.has("Content-Type")) {
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

    return {
      email: typeof payload.email === "string" ? payload.email : null,
      role: typeof appMetadata.role === "string" ? appMetadata.role : "student",
      fullName:
        typeof userMetadata.full_name === "string"
          ? userMetadata.full_name
          : typeof userMetadata.name === "string"
            ? userMetadata.name
            : null,
    };
  },

  async loginWithCredentials(email: string, password: string): Promise<void> {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new ApiError("Supabase auth is not configured in frontend env", 500);
    }

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    const payload = (await response.json().catch(() => null)) as SupabaseAuthResponse | null;
    if (!response.ok || !payload?.access_token) {
      throw new ApiError(
        payload?.error_description ?? payload?.msg ?? "Invalid email or password",
        response.status || 401,
      );
    }

    const token = payload.access_token;
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
    return request<SubmissionItem[]>(`/api/reviews/submissions/${submissionId}/items`);
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
};
