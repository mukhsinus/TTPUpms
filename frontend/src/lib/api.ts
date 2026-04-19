import type { Category, Submission, SubmissionItem, SubmissionStatus, User } from "../types";
import { signInWithPasswordViaFetch, signInWithSupabasePassword } from "./auth-sign-in";
import { ApiError } from "./api-error";
import { isAdminPanelRole, normalizeRole, type AppRole } from "./rbac";
import { getSupabaseBrowserEnv } from "./supabase-env";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? "";
const AUTH_TOKEN_KEY = "upms_admin_token";
/** Server `public.users.role` after login — source of truth (JWT app_metadata is ignored for RBAC UI). */
const AUTH_ROLE_KEY = "upms_session_role";
const ADMIN_SESSION_ID_KEY = "upms_admin_session_id";

/** Treat JWT as expired this many ms before `exp` to avoid edge 401s from clock skew. */
const JWT_EXPIRY_SKEW_MS = 60_000;

let sessionRedirectInProgress = false;
let syncSessionRoleInFlight: Promise<void> | null = null;
let adminDashboardCache:
  | {
      key: string;
      expiresAt: number;
      data: AdminDashboardPayload;
    }
  | null = null;
let adminSubmissionsCache = new Map<
  string,
  {
    expiresAt: number;
    data: AdminSubmissionsListPayload;
  }
>();
let adminSubmissionDetailCache = new Map<
  string,
  {
    expiresAt: number;
    data: AdminSubmissionDetailPayload;
  }
>();
let adminProfileCache:
  | {
      key: string;
      expiresAt: number;
      data: AdminProfilePayload;
    }
  | null = null;

const ADMIN_LIST_CACHE_TTL_MS = 10_000;
const ADMIN_DETAIL_CACHE_TTL_MS = 15_000;

interface RequestResultOptions {
  /** When true, a 401 does not clear storage or navigate (e.g. login probe before token is stored). */
  skipUnauthorizedRedirect?: boolean;
  /** Attach `x-admin-session-id` for admin-panel auth bootstrap. */
  forceAdminSessionHeader?: boolean;
}

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

interface AuthMePayload {
  userId: string;
  email: string | null;
  role: string;
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

export type AdminModerationStatus = "pending" | "approved" | "rejected";

export interface AdminSubmissionListItem {
  id: string;
  userId: string;
  studentId: string | null;
  categoryCode: string | null;
  /** Human-readable label from DB (`categories.title`) or derived from `categories.name`. */
  categoryTitle: string | null;
  subcategorySlug: string | null;
  title: string;
  status: AdminModerationStatus;
  createdAt: string;
  submittedAt: string;
  score: number | null;
  ownerName: string | null;
}

export interface AdminSubmissionsListPayload {
  items: AdminSubmissionListItem[];
  total: number;
  pendingCount: number;
  page: number;
  pageSize: number;
}

export interface AdminProfilePayload {
  identity: {
    id: string;
    fullName: string;
    email: string | null;
    role: "admin" | "superadmin";
    adminCode: string;
    joinedAt: string | null;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
    lastLoginUserAgent: string | null;
  };
  permissions: {
    approveSubmissions: boolean;
    rejectSubmissions: boolean;
    exportCsv: boolean;
    manageAdmins: boolean;
    viewGlobalAuditLogs: boolean;
    securityApprovals: boolean;
  };
  stats: {
    approvals: number;
    rejects: number;
    avgReviewMinutes: number;
    actions7d: number;
  };
  recentActions: Array<{
    id: string;
    action: "approved" | "rejected" | "edited_score" | "reopened" | "login";
    studentId: string | null;
    submissionId: string | null;
    submissionTitle: string | null;
    createdAt: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  security: {
    currentSessionActive: boolean;
    activeSessionsCount: number;
    logoutOtherSessionsRestricted: boolean;
    restrictionReason: string | null;
    pendingSecurityEvents: Array<{
      id: string;
      type: "new_device_login" | "logout_others_request" | "admin_registration";
      status: "pending" | "approved" | "rejected";
      createdAt: string;
    }>;
    sessions: Array<{
      id: string;
      isCurrent: boolean;
      deviceName: string;
      ip: string | null;
      lastSeenAt: string;
      createdAt: string;
      isRevoked: boolean;
    }>;
  };
}

export interface AdminDashboardMetrics {
  pendingCount: number;
  approvedToday: number;
  rejectedToday: number;
  totalProcessed: number;
}

export type DashboardQueueHealth = "healthy" | "moderate" | "overloaded";

export interface AdminNeedsAttentionItem {
  submissionId: string;
  label: string;
  studentId: string | null;
  studentName: string | null;
  title: string;
  waitingHours: number;
  missingProofFile: boolean;
  waitingOver24h: boolean;
  needsManualScore: boolean;
  reason: "missing_proof_file" | "waiting_over_24h" | "manual_scoring_needed" | "oldest_pending";
}

export interface AdminRecentActivityItem {
  id: string;
  action: "approved" | "rejected" | "edited_score" | "reopened" | "login";
  adminId: string;
  adminName: string;
  adminEmail: string | null;
  studentId: string | null;
  studentName: string | null;
  submissionId: string | null;
  submissionTitle: string | null;
  submissionSubmittedAt: string | null;
  createdAt: string;
}

export interface AdminDashboardPayload {
  pendingCount: number;
  avgReviewTimeHours: number;
  oldestPendingHours: number;
  processed7d: number;
  queueHealth: DashboardQueueHealth;
  needsAttention: AdminNeedsAttentionItem[];
  recentActivity: AdminRecentActivityItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
}

export interface AdminActivityProfilePayload {
  admin: {
    id: string;
    name: string;
    email: string | null;
  };
  totals: {
    totalActions: number;
    approvals: number;
    rejects: number;
  };
  recentActivity: AdminRecentActivityItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
}

export interface SuperadminDashboardPayload {
  pendingQueue: number;
  processed7d: number;
  avgReviewMinutes: number;
  activeAdminsToday: number;
  securityAlertsCount: number;
  overloadedQueue: boolean;
  alerts: Array<{
    code: string;
    message: string;
    severity: "warning" | "critical";
  }>;
}

export interface SuperadminAdminListPayload {
  items: Array<{
    id: string;
    name: string | null;
    email: string | null;
    role: "admin" | "superadmin";
    status: "active" | "suspended";
    createdAt: string;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
    approvals: number;
    rejects: number;
    avgReviewMinutes: number;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
}

export interface SuperadminAdminDetailPayload {
  identity: {
    id: string;
    fullName: string | null;
    email: string | null;
    role: "admin" | "superadmin";
    status: "active" | "suspended";
    createdAt: string;
    suspendedAt: string | null;
    suspensionReason: string | null;
    lastLoginAt: string | null;
    lastLoginIp: string | null;
  };
  stats: {
    approvals: number;
    rejects: number;
    avgReviewMinutes: number;
  };
  recentActivity: Array<{
    id: string;
    action: string;
    targetTable: string | null;
    targetId: string | null;
    createdAt: string;
  }>;
  sessions: Array<{
    id: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
    lastSeenAt: string;
    revokedAt: string | null;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
}

export interface SuperadminAuditLogsPayload {
  items: Array<{
    id: string;
    time: string;
    actorId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    action: string;
    targetTable: string | null;
    targetId: string | null;
    details: Record<string, unknown> | null;
    ip: string | null;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
}

export interface SuperadminSecurityEventsPayload {
  items: Array<{
    id: string;
    adminId: string;
    adminName: string | null;
    adminEmail: string | null;
    type: "new_device_login" | "logout_others_request" | "admin_registration";
    status: "pending" | "approved" | "rejected";
    metadata: Record<string, unknown> | null;
    approvedBy: string | null;
    approvedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
}

export interface AdminSubmissionDetailPayload {
  submission: {
    id: string;
    userId: string;
    title: string;
    description: string | null;
    status: AdminModerationStatus;
    workflowStatus?: string;
    totalPoints: number;
    submittedAt?: string | null;
    reviewedAt?: string | null;
    reviewedById?: string | null;
    reviewerEmail?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  items: Array<{
    id: string;
    title: string;
    description: string | null;
    proofFileUrl: string | null;
    externalLink: string | null;
    proposedScore: number | null;
    approvedScore: number | null;
    status: string;
    categoryCode: string | null;
    categoryName: string | null;
    categoryTitle?: string | null;
    subcategorySlug: string | null;
    subcategoryLabel: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  files: Array<{
    id: string;
    fileUrl: string | null;
    originalFilename: string;
    mimeType: string | null;
    submissionItemId: string | null;
    submissionId: string | null;
    createdAt: string;
  }>;
  link: string | null;
  user: {
    studentFullName: string | null;
    faculty: string | null;
    studentId: string | null;
    telegramUsername: string | null;
  } | null;
}

/** Item payload from PATCH /api/reviews/items/:itemId (and POST review item). */
export interface ReviewSubmissionItemResponse {
  id: string;
  submissionId: string;
  userId: string;
  category: string;
  subcategory: string | null;
  subcategoryId?: string;
  metadata?: Record<string, unknown>;
  categoryType?: string;
  title: string;
  description: string | null;
  proposedScore: number | null;
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
  fullName: string | null;
  telegramUsername: string | null;
  telegramId: string | null;
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
  sessionRedirectInProgress = false;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function setSessionRoleFromServer(role: string): void {
  try {
    localStorage.setItem(AUTH_ROLE_KEY, normalizeRole(role));
  } catch {
    /* ignore */
  }
}

function clearSessionRole(): void {
  try {
    localStorage.removeItem(AUTH_ROLE_KEY);
  } catch {
    /* ignore */
  }
}

function getOrCreateAdminSessionId(): string {
  try {
    const existing = localStorage.getItem(ADMIN_SESSION_ID_KEY);
    if (existing && existing.trim().length > 0) {
      return existing.trim();
    }
    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `adm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(ADMIN_SESSION_ID_KEY, generated);
    return generated;
  } catch {
    return `adm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

async function updateSupabaseUser(authToken: string, payload: Record<string, unknown>): Promise<void> {
  const { url, anonKey } = getSupabaseBrowserEnv();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(text || `Supabase user update failed (${response.status})`, response.status);
  }
}

function keyFromSubmissionsParams(params: {
  page?: number;
  pageSize?: number;
  status?: AdminModerationStatus;
  category?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}): string {
  return JSON.stringify({
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    status: params.status ?? "",
    category: params.category?.trim() ?? "",
    search: params.search?.trim() ?? "",
    dateFrom: params.dateFrom ?? "",
    dateTo: params.dateTo ?? "",
  });
}

function getStoredServerRole(): AppRole | null {
  try {
    const raw = localStorage.getItem(AUTH_ROLE_KEY);
    return raw ? normalizeRole(raw) : null;
  } catch {
    return null;
  }
}

function shouldHydrateSessionRole(): boolean {
  return sessionIsValid() && getStoredServerRole() === null;
}

function getTokenExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return null;
  return payload.exp * 1000;
}

function isAccessTokenExpired(token: string): boolean {
  const expMs = getTokenExpiryMs(token);
  if (expMs === null) return true;
  return Date.now() >= expMs - JWT_EXPIRY_SKEW_MS;
}

function sessionIsValid(): boolean {
  const token = getAuthToken();
  if (!token) return false;
  if (isAccessTokenExpired(token)) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.sub !== "string") return false;
  return true;
}

function invalidateSessionAndRedirect(): void {
  if (typeof window === "undefined") return;
  if (sessionRedirectInProgress) return;
  sessionRedirectInProgress = true;
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_ROLE_KEY);
    localStorage.removeItem(ADMIN_SESSION_ID_KEY);
  } catch {
    /* ignore */
  }
  const path = window.location.pathname;
  if (path === "/login") {
    sessionRedirectInProgress = false;
    return;
  }
  window.location.replace("/login");
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

async function requestResult<T>(
  path: string,
  init?: RequestInit,
  token?: string,
  options?: RequestResultOptions,
): Promise<ApiResult<T>> {
  const headers = new Headers(init?.headers);
  const authToken = token ?? getAuthToken();

  if (init?.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  const role = getStoredServerRole();
  const shouldAttachAdminSession =
    Boolean(authToken) &&
    (options?.forceAdminSessionHeader || path.startsWith("/api/admin") || role === "admin" || role === "superadmin");
  if (shouldAttachAdminSession) {
    headers.set("x-admin-session-id", getOrCreateAdminSessionId());
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
      if (!options?.skipUnauthorizedRedirect) {
        invalidateSessionAndRedirect();
      }
      return { data: null, error: "Unauthorized. Please login again.", statusCode: 401 };
    }
    if (response.status === 403) {
      return { data: null, error: message, statusCode: 403 };
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
  /** True when a non-expired JWT with `sub` is stored (client-side check only). */
  isSessionValid(): boolean {
    return sessionIsValid();
  },

  isLoggedIn(): boolean {
    return sessionIsValid();
  },

  logout(): void {
    sessionRedirectInProgress = false;
    localStorage.removeItem(AUTH_TOKEN_KEY);
    clearSessionRole();
    try {
      localStorage.removeItem(ADMIN_SESSION_ID_KEY);
    } catch {
      /* ignore */
    }
    adminDashboardCache = null;
    adminProfileCache = null;
    adminSubmissionsCache.clear();
    adminSubmissionDetailCache.clear();
  },

  getSessionUser(): SessionUser | null {
    if (!sessionIsValid()) return null;
    const token = getAuthToken();
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    if (!payload) return null;

    const userMetadata = (payload.user_metadata as Record<string, unknown> | undefined) ?? {};
    const appMetadata = (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
    const rawRole = typeof appMetadata.role === "string" ? appMetadata.role : "student";
    const serverRole = getStoredServerRole();

    return {
      userId: typeof payload.sub === "string" ? payload.sub : null,
      email: typeof payload.email === "string" ? payload.email : null,
      role: serverRole ?? normalizeRole(rawRole),
      fullName:
        typeof userMetadata.full_name === "string"
          ? userMetadata.full_name
          : typeof userMetadata.name === "string"
            ? userMetadata.name
            : null,
    };
  },

  /** Fetches `public.users.role` from the API and stores it for `getSessionUser` / RequireRole. */
  async syncSessionRoleFromServer(): Promise<void> {
    if (!sessionIsValid()) {
      return;
    }
    if (syncSessionRoleInFlight) {
      return syncSessionRoleInFlight;
    }
    syncSessionRoleInFlight = (async () => {
      try {
        const result = await requestResult<AuthMePayload>(
          "/api/auth/me",
          { method: "GET" },
          undefined,
          { skipUnauthorizedRedirect: true },
        );
        if (result.data?.role) {
          setSessionRoleFromServer(result.data.role);
        }
      } finally {
        syncSessionRoleInFlight = null;
      }
    })();
    return syncSessionRoleInFlight;
  },

  needsSessionRoleHydration(): boolean {
    return shouldHydrateSessionRole();
  },

  async loginWithCredentials(
    email: string,
    password: string,
    options?: { authSource?: "admin_panel" },
  ): Promise<void> {
    const token = await signInWithSupabasePassword(email, password);
    const headers = new Headers();
    if (options?.authSource === "admin_panel") {
      headers.set("X-Upms-Auth-Source", "admin_panel");
    }
    const me = await requestResult<AuthMePayload>(
      "/api/auth/me",
      { method: "GET", headers },
      token,
      { skipUnauthorizedRedirect: true, forceAdminSessionHeader: options?.authSource === "admin_panel" },
    );
    if (me.error) {
      throw new ApiError(me.error, me.statusCode);
    }
    if (!me.data?.role) {
      throw new ApiError("Invalid auth profile response", 500);
    }

    setAuthToken(token);
    setSessionRoleFromServer(me.data.role);
    adminDashboardCache = null;
    adminProfileCache = null;
    adminSubmissionsCache.clear();
    adminSubmissionDetailCache.clear();
  },

  async getDashboardStats(): Promise<{
    totalSubmissions: number;
    pendingReview: number;
    approved: number;
    rejected: number;
  }> {
    const submissions = await request<Submission[]>("/api/submissions");
    const pending = submissions.filter((item) => item.status === "submitted" || item.status === "review").length;
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
    subcategory_id?: string;
    subcategory?: string;
    metadata?: Record<string, string | number | boolean>;
    title: string;
    description?: string;
    proof_file_url?: string;
    external_link?: string;
    proposed_score?: number;
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
    /** Omitted for fixed categories (server derives score from scoring_rules + metadata). */
    approved_score?: number;
    status: "approved" | "rejected";
    reviewer_comment?: string;
  }): Promise<ReviewSubmissionItemResponse> {
    return request<ReviewSubmissionItemResponse>(`/api/reviews/items/${input.itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(input.approved_score !== undefined ? { approved_score: input.approved_score } : {}),
        status: input.status,
        reviewer_comment: input.reviewer_comment,
      }),
    });
  },

  /** POST /api/reviews/submissions/:id/start-review — submitted → review. */
  startSubmissionReview(submissionId: string): Promise<Submission> {
    return request<Submission>(`/api/reviews/submissions/${submissionId}/start-review`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  /** POST /api/reviews/submissions/:id/finalize — alias of /complete; review → outcome. */
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
    }).then((data) => {
      adminSubmissionDetailCache.delete(input.submissionId);
      adminSubmissionsCache.clear();
      adminDashboardCache = null;
      return data;
    });
  },

  setSubmissionScore(input: { submissionId: string; totalScore: number; reason?: string }): Promise<Submission> {
    return request<Submission>(`/api/admin/submissions/${input.submissionId}/override-score`, {
      method: "PATCH",
      body: JSON.stringify({
        totalScore: input.totalScore,
        reason: input.reason,
      }),
    }).then((data) => {
      adminSubmissionDetailCache.delete(input.submissionId);
      adminSubmissionsCache.clear();
      adminDashboardCache = null;
      return data;
    });
  },

  getAdminMetrics(): Promise<AdminDashboardMetrics> {
    return request<AdminDashboardMetrics>("/api/admin/metrics");
  },

  getAdminDashboard(params?: { page?: number; pageSize?: number; forceRefresh?: boolean }): Promise<AdminDashboardPayload> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 20;
    const cacheKey = `${page}:${pageSize}`;
    const now = Date.now();
    if (!params?.forceRefresh && adminDashboardCache && adminDashboardCache.key === cacheKey && adminDashboardCache.expiresAt > now) {
      return Promise.resolve(adminDashboardCache.data);
    }
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    return request<AdminDashboardPayload>(`/api/admin/dashboard?${q.toString()}`).then((data) => {
      adminDashboardCache = {
        key: cacheKey,
        expiresAt: Date.now() + 10_000,
        data,
      };
      return data;
    });
  },

  getSuperadminDashboard(): Promise<SuperadminDashboardPayload> {
    return request<SuperadminDashboardPayload>("/api/admin/super/dashboard");
  },

  getAdminProfile(params?: { page?: number; pageSize?: number; forceRefresh?: boolean }): Promise<AdminProfilePayload> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 10;
    const cacheKey = `${page}:${pageSize}`;
    const now = Date.now();
    if (!params?.forceRefresh && adminProfileCache && adminProfileCache.key === cacheKey && adminProfileCache.expiresAt > now) {
      return Promise.resolve(adminProfileCache.data);
    }
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    return request<AdminProfilePayload>(`/api/admin/profile?${q.toString()}`).then((data) => {
      adminProfileCache = {
        key: cacheKey,
        expiresAt: Date.now() + 10_000,
        data,
      };
      return data;
    });
  },

  async updateAdminIdentity(input: {
    fullName: string;
    email: string;
    previousEmail: string | null;
    currentPassword?: string;
  }): Promise<void> {
    const token = getAuthToken();
    if (!token) {
      throw new ApiError("Not authenticated", 401);
    }
    const nextEmail = input.email.trim().toLowerCase();
    const prevEmail = input.previousEmail?.trim().toLowerCase() ?? null;
    const emailChanged = Boolean(prevEmail && prevEmail !== nextEmail);
    if (emailChanged) {
      if (!input.currentPassword?.trim()) {
        throw new ApiError("Current password is required to change email", 400);
      }
      await signInWithPasswordViaFetch(prevEmail as string, input.currentPassword.trim());
      await updateSupabaseUser(token, { email: nextEmail });
    }
    await request<{ ok: boolean }>("/api/admin/profile", {
      method: "PATCH",
      body: JSON.stringify({
        full_name: input.fullName.trim(),
        email: nextEmail,
      }),
    });
    adminProfileCache = null;
  },

  async changeAdminPassword(input: {
    currentPassword: string;
    newPassword: string;
    email: string | null;
  }): Promise<void> {
    const token = getAuthToken();
    if (!token) {
      throw new ApiError("Not authenticated", 401);
    }
    const email = input.email?.trim().toLowerCase();
    if (!email) {
      throw new ApiError("Current email is not available for password verification", 400);
    }
    await signInWithPasswordViaFetch(email, input.currentPassword.trim());
    await updateSupabaseUser(token, { password: input.newPassword });
  },

  async logoutCurrentAdminSession(): Promise<void> {
    await request<{ ok: boolean }>("/api/admin/profile/logout-current", {
      method: "POST",
      body: JSON.stringify({}),
    });
    adminProfileCache = null;
  },

  async logoutOtherAdminSessions(): Promise<{ revokedCount: number; restricted: boolean }> {
    const data = await request<{ revokedCount: number; restricted: boolean }>("/api/admin/profile/logout-others", {
      method: "POST",
      body: JSON.stringify({}),
    });
    adminProfileCache = null;
    return data;
  },

  async approveAdminSecurityEvent(eventId: string): Promise<void> {
    await request<{ ok: boolean }>(`/api/admin/profile/security-events/${eventId}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    adminProfileCache = null;
  },

  getAdminActivityProfile(
    adminId: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<AdminActivityProfilePayload> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 10;
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    return request<AdminActivityProfilePayload>(`/api/admin/dashboard/admins/${adminId}?${q.toString()}`);
  },

  getSuperadminAdmins(params?: { page?: number; pageSize?: number; search?: string }): Promise<SuperadminAdminListPayload> {
    const q = new URLSearchParams({
      page: String(params?.page ?? 1),
      pageSize: String(params?.pageSize ?? 20),
    });
    if (params?.search?.trim()) {
      q.set("search", params.search.trim());
    }
    return request<SuperadminAdminListPayload>(`/api/admin/admins?${q.toString()}`);
  },

  getSuperadminAdminDetail(
    adminId: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<SuperadminAdminDetailPayload> {
    const q = new URLSearchParams({
      page: String(params?.page ?? 1),
      pageSize: String(params?.pageSize ?? 10),
    });
    return request<SuperadminAdminDetailPayload>(`/api/admin/admins/${adminId}?${q.toString()}`);
  },

  async setSuperadminRole(adminId: string, role: "admin" | "superadmin"): Promise<void> {
    await request<{ ok: boolean }>(`/api/admin/admins/${adminId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  },

  async setAdminStatus(adminId: string, status: "active" | "suspended", reason?: string): Promise<void> {
    await request<{ ok: boolean }>(`/api/admin/admins/${adminId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },

  resetAdminPassword(adminId: string, temporaryPassword?: string): Promise<{ temporaryPassword: string; email: string | null }> {
    return request<{ temporaryPassword: string; email: string | null }>(`/api/admin/admins/${adminId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ temporaryPassword }),
    });
  },

  getSuperadminAuditLogs(params?: {
    page?: number;
    pageSize?: number;
    adminId?: string;
    action?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<SuperadminAuditLogsPayload> {
    const q = new URLSearchParams({
      page: String(params?.page ?? 1),
      pageSize: String(params?.pageSize ?? 25),
    });
    if (params?.adminId) q.set("adminId", params.adminId);
    if (params?.action) q.set("action", params.action);
    if (params?.search?.trim()) q.set("search", params.search.trim());
    if (params?.dateFrom) q.set("dateFrom", params.dateFrom);
    if (params?.dateTo) q.set("dateTo", params.dateTo);
    return request<SuperadminAuditLogsPayload>(`/api/admin/audit?${q.toString()}`);
  },

  getSuperadminSecurityEvents(params?: {
    page?: number;
    pageSize?: number;
    status?: "pending" | "approved" | "rejected";
    type?: "new_device_login" | "logout_others_request" | "admin_registration";
  }): Promise<SuperadminSecurityEventsPayload> {
    const q = new URLSearchParams({
      page: String(params?.page ?? 1),
      pageSize: String(params?.pageSize ?? 25),
    });
    if (params?.status) q.set("status", params.status);
    if (params?.type) q.set("type", params.type);
    return request<SuperadminSecurityEventsPayload>(`/api/admin/security/events?${q.toString()}`);
  },

  async resolveSecurityEvent(eventId: string, status: "approved" | "rejected"): Promise<void> {
    await request<{ ok: boolean }>(`/api/admin/security/events/${eventId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  },

  revokeAdminSessions(adminId: string): Promise<{ revokedCount: number }> {
    return request<{ revokedCount: number }>(`/api/admin/security/admins/${adminId}/revoke-sessions`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  async assignSubmissionToAdmin(submissionId: string, adminId: string): Promise<void> {
    await request<{ ok: boolean }>(`/api/admin/submissions/${submissionId}/assign`, {
      method: "POST",
      body: JSON.stringify({ adminId }),
    });
  },

  async addSubmissionInternalNote(submissionId: string, note: string): Promise<void> {
    await request<{ ok: boolean }>(`/api/admin/submissions/${submissionId}/notes`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  },

  getSubmissionInternalNotes(submissionId: string): Promise<
    Array<{ id: string; submission_id: string; admin_id: string; admin_name: string | null; note: string; created_at: string }>
  > {
    return request<Array<{ id: string; submission_id: string; admin_id: string; admin_name: string | null; note: string; created_at: string }>>(
      `/api/admin/submissions/${submissionId}/notes`,
    );
  },

  async downloadReportCsv(
    kind: "moderation-performance" | "admin-productivity" | "approval-summary" | "audit-export",
    fromIso: string,
    toIso: string,
  ): Promise<Blob> {
    const token = getAuthToken();
    const q = new URLSearchParams({ from: fromIso, to: toIso });
    const path = `/api/admin/reports/${kind}.csv?${q.toString()}`;
    const headers = new Headers();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const sessionUser = api.getSessionUser();
    if (sessionUser && isAdminPanelRole(sessionUser)) {
      headers.set("x-admin-session-id", getOrCreateAdminSessionId());
    }
    const response = await fetch(`${API_BASE_URL}${path}`, { method: "GET", headers });
    if (!response.ok) {
      throw new ApiError(`CSV export failed (${response.status})`, response.status);
    }
    return response.blob();
  },

  getAdminSubmissions(params: {
    page?: number;
    pageSize?: number;
    status?: AdminModerationStatus;
    category?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    forceRefresh?: boolean;
  }): Promise<AdminSubmissionsListPayload> {
    const cacheKey = keyFromSubmissionsParams(params);
    const now = Date.now();
    const cached = adminSubmissionsCache.get(cacheKey);
    if (!params.forceRefresh && cached && cached.expiresAt > now) {
      return Promise.resolve(cached.data);
    }

    const q = new URLSearchParams();
    if (params.page !== undefined) {
      q.set("page", String(params.page));
    }
    if (params.pageSize !== undefined) {
      q.set("pageSize", String(params.pageSize));
    }
    if (params.status) {
      q.set("status", params.status);
    }
    if (params.category) {
      q.set("category", params.category);
    }
    if (params.search?.trim()) {
      q.set("search", params.search.trim());
    }
    if (params.dateFrom) {
      q.set("dateFrom", params.dateFrom);
    }
    if (params.dateTo) {
      q.set("dateTo", params.dateTo);
    }
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<AdminSubmissionsListPayload>(`/api/admin/submissions${suffix}`).then((data) => {
      adminSubmissionsCache.set(cacheKey, {
        expiresAt: Date.now() + ADMIN_LIST_CACHE_TTL_MS,
        data,
      });
      return data;
    });
  },

  getAdminSubmissionDetail(submissionId: string, options?: { forceRefresh?: boolean }): Promise<AdminSubmissionDetailPayload> {
    const key = submissionId;
    const now = Date.now();
    const cached = adminSubmissionDetailCache.get(key);
    if (!options?.forceRefresh && cached && cached.expiresAt > now) {
      return Promise.resolve(cached.data);
    }
    return request<AdminSubmissionDetailPayload>(`/api/admin/submissions/${submissionId}`).then((data) => {
      adminSubmissionDetailCache.set(key, {
        expiresAt: Date.now() + ADMIN_DETAIL_CACHE_TTL_MS,
        data,
      });
      return data;
    });
  },

  adminApproveSubmission(submissionId: string, body: { score?: number }): Promise<AdminSubmissionDetailPayload["submission"]> {
    return request<AdminSubmissionDetailPayload["submission"]>(`/api/admin/submissions/${submissionId}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then((data) => {
      adminSubmissionDetailCache.delete(submissionId);
      adminSubmissionsCache.clear();
      adminDashboardCache = null;
      adminProfileCache = null;
      return data;
    });
  },

  adminRejectSubmission(
    submissionId: string,
    body: { reason: string },
  ): Promise<AdminSubmissionDetailPayload["submission"]> {
    return request<AdminSubmissionDetailPayload["submission"]>(`/api/admin/submissions/${submissionId}/reject`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then((data) => {
      adminSubmissionDetailCache.delete(submissionId);
      adminSubmissionsCache.clear();
      adminDashboardCache = null;
      adminProfileCache = null;
      return data;
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
