import type { Submission, SubmissionItem, SubmissionStatus, User } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const AUTH_TOKEN_KEY = "upms_admin_token";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.message ?? "Request failed");
  }

  return payload.data;
}

export const api = {
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

  async getUsers(): Promise<User[]> {
    try {
      return await request<User[]>("/api/admin/users");
    } catch {
      return [];
    }
  },
};
