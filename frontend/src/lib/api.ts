import type { Submission, SubmissionItem, SubmissionStatus, User } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? "";
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

  async login(token: string): Promise<void> {
    const normalized = token.trim();
    if (!normalized) {
      throw new ApiError("Token is required", 400);
    }

    const result = await requestResult<Submission[]>("/api/submissions", { method: "GET" }, normalized);
    if (result.error) {
      throw new ApiError(result.error, result.statusCode);
    }

    setAuthToken(normalized);
  },

  async getDashboardStats(): Promise<{
    totalSubmissions: number;
    pendingReview: number;
    approved: number;
    rejected: number;
  }> {
    const submissions = await request<Submission[]>("/api/reviews/submissions");
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
    return request<Submission[]>("/api/reviews/submissions");
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
};
