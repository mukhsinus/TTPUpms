import type { FastifyInstance } from "fastify";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import { env } from "../../config/env";
import {
  extractStoragePathFromSupabasePublicUrl,
  normalizeLegacyStorageObjectPath,
  normalizeLegacyStoragePathForRead,
} from "../files/proof-reference";
import { mapPgErrorToClient } from "../../utils/pg-http-map";
import { ServiceError } from "../../utils/service-error";
import type {
  AdminActivityRow,
  AdminActivitySummaryRow,
  AdminDashboardSummaryRow,
  AdminFileRow,
  AdminItemRow,
  AdminNeedsAttentionRow,
  AdminSearchSuggestionKind,
  AdminSearchSuggestionRow,
  AdminSubmissionDetailRow,
  AdminSubmissionListRow,
  AdminStudentOverviewRow,
  AdminStudentDetailRow,
  AdminStudentListRow,
  AdminUserRow,
} from "./admin.repository";
import { AdminRepository } from "./admin.repository";
import type {
  AdminApproveBody,
  AdminDashboardQuery,
  AdminModerationStatus,
  AdminRejectBody,
  AdminSubmissionsQuery,
  AdminStudentsQuery,
  AdminUpdateStudentBody,
} from "./admin.schema";

export const ADMIN_PROCESSABLE_STATUSES = new Set<string>(["submitted", "review", "needs_revision"]);

function toModerationStatus(dbStatus: string): AdminModerationStatus {
  if (dbStatus === "approved") {
    return "approved";
  }
  if (dbStatus === "rejected") {
    return "rejected";
  }
  return "pending";
}

function numOrNull(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type ItemModerationStatus = "pending" | "approved" | "rejected";
type SubmissionItemAggregateStatus = "pending" | "approved" | "partially_approved" | "rejected";

function normalizeItemModerationStatus(value: string | null | undefined): ItemModerationStatus {
  if (value === "approved") {
    return "approved";
  }
  if (value === "rejected") {
    return "rejected";
  }
  return "pending";
}

type DashboardQueueHealth = "healthy" | "moderate" | "overloaded";

function queueHealthFromPending(pendingCount: number): DashboardQueueHealth {
  if (pendingCount <= 5) return "healthy";
  if (pendingCount <= 20) return "moderate";
  return "overloaded";
}

export class AdminService {
  private dashboardCache = new Map<
    string,
    {
      expiresAt: number;
      data: Awaited<ReturnType<AdminService["buildDashboard"]>>;
    }
  >();
  private submissionsCache = new Map<
    string,
    {
      expiresAt: number;
      data: Awaited<ReturnType<AdminService["buildSubmissionsList"]>>;
    }
  >();

  private readonly dashboardCacheTtlMs = 20_000;
  private readonly submissionsCacheTtlMs = 12_000;

  constructor(
    private readonly app: FastifyInstance,
    private readonly repository: AdminRepository,
    private readonly audit: AuditLogRepository,
    private readonly notifications: NotificationService,
  ) {}

  private invalidateReadCaches(): void {
    this.dashboardCache.clear();
    this.submissionsCache.clear();
  }

  async getMetrics(): Promise<{
    pendingCount: number;
    approvedToday: number;
    rejectedToday: number;
    totalProcessed: number;
  }> {
    const row = await this.repository.getMetrics();
    return {
      pendingCount: Number(row.pending_count),
      approvedToday: Number(row.approved_today),
      rejectedToday: Number(row.rejected_today),
      totalProcessed: Number(row.total_processed),
    };
  }

  async getDashboard(query: AdminDashboardQuery): Promise<{
    pendingCount: number;
    avgReviewTimeHours: number;
    oldestPendingHours: number;
    processed7d: number;
    queueHealth: DashboardQueueHealth;
    needsAttention: Array<{
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
    }>;
    recentActivity: Array<{
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
    }>;
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
  }> {
    if (!query.forceRefresh) {
      const key = `${query.page}:${query.pageSize}`;
      const cached = this.dashboardCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }
    }
    const data = await this.buildDashboard(query);
    if (!query.forceRefresh) {
      const key = `${query.page}:${query.pageSize}`;
      this.dashboardCache.set(key, {
        expiresAt: Date.now() + this.dashboardCacheTtlMs,
        data,
      });
    }
    return data;
  }

  private async buildDashboard(query: AdminDashboardQuery): Promise<{
    pendingCount: number;
    avgReviewTimeHours: number;
    oldestPendingHours: number;
    processed7d: number;
    queueHealth: DashboardQueueHealth;
    needsAttention: Array<{
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
    }>;
    recentActivity: Array<{
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
    }>;
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
  }> {
    const [summary, needsAttentionRows, activityRows, totalActivity] = await Promise.all([
      this.repository.getDashboardSummary(),
      this.repository.listNeedsAttention(5),
      this.repository.listRecentActivity(query.page, query.pageSize),
      this.repository.countRecentActivity(),
    ]);

    const pendingCount = Number(summary.pending_count ?? "0");
    const totalPages = Math.max(1, Math.ceil(totalActivity / query.pageSize));

    return {
      pendingCount,
      avgReviewTimeHours: Number(summary.avg_review_time_hours ?? "0"),
      oldestPendingHours: Number(summary.oldest_pending_hours ?? "0"),
      processed7d: Number(summary.processed_7d ?? "0"),
      queueHealth: queueHealthFromPending(pendingCount),
      needsAttention: needsAttentionRows.map((row) => this.mapNeedsAttentionRow(row)),
      recentActivity: activityRows.map((row) => this.mapActivityRow(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: totalActivity,
        totalPages,
        hasPrev: query.page > 1,
        hasNext: query.page < totalPages,
      },
    };
  }

  async getAdminActivityProfile(
    adminId: string,
    query: AdminDashboardQuery,
  ): Promise<{
    admin: { id: string; name: string; email: string | null };
    totals: { totalActions: number; approvals: number; rejects: number };
    recentActivity: Array<{
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
    }>;
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
  }> {
    const [admin, summary, rows, total] = await Promise.all([
      this.repository.findAdminUserById(adminId),
      this.repository.getAdminActivitySummary(adminId),
      this.repository.listRecentActivityByAdmin(adminId, query.page, query.pageSize),
      this.repository.countRecentActivityByAdmin(adminId),
    ]);

    if (!admin) {
      throw new ServiceError(404, "Admin user not found");
    }

    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    return {
      admin,
      totals: this.mapActivitySummary(summary),
      recentActivity: rows.map((row) => this.mapActivityRow(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasPrev: query.page > 1,
        hasNext: query.page < totalPages,
      },
    };
  }

  async listSubmissions(query: AdminSubmissionsQuery): Promise<{
    items: ReturnType<AdminService["mapListRow"]>[];
    total: number;
    pendingCount: number;
    page: number;
    pageSize: number;
  }> {
    const cacheKey = JSON.stringify({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status ?? "",
      category: query.category ?? "",
      search: query.search ?? "",
      dateFrom: query.dateFrom ?? "",
      dateTo: query.dateTo ?? "",
      sort: query.sort,
      order: query.order,
    });
    if (!query.forceRefresh) {
      const cached = this.submissionsCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }
    }
    const data = await this.buildSubmissionsList(query);
    if (!query.forceRefresh) {
      this.submissionsCache.set(cacheKey, {
        expiresAt: Date.now() + this.submissionsCacheTtlMs,
        data,
      });
    }
    return data;
  }

  async listSearchSuggestions(query: { q: string; limit: number }): Promise<
    Array<{
      kind: AdminSearchSuggestionKind;
      value: string;
      label: string;
      meta: string | null;
    }>
  > {
    const rows = await this.repository.searchSuggestions(query.q, query.limit);
    return rows.map((row) => this.mapSearchSuggestionRow(row));
  }

  async getStudentOverview(studentId: string): Promise<{
    userId: string;
    studentId: string;
    studentName: string | null;
    faculty: string | null;
    telegramUsername: string | null;
    totalSubmissions: number;
    pendingSubmissions: number;
    approvedSubmissions: number;
    rejectedSubmissions: number;
    totalApprovedScore: number;
  } | null> {
    const row = await this.repository.findStudentOverviewByStudentId(studentId);
    if (!row) {
      return null;
    }
    return this.mapStudentOverviewRow(row);
  }

  async listStudents(query: AdminStudentsQuery): Promise<{
    items: Array<{
      id: string;
      fullName: string;
      telegramUsername: string | null;
      telegramId: string | null;
      degree: "bachelor" | "master" | null;
      faculty: string | null;
      studentId: string | null;
      registrationDate: string;
      lastActivityAt: string;
      totalAchievementsSubmitted: number;
      totalApprovedScore: number;
    }>;
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasPrev: boolean;
      hasNext: boolean;
    };
  }> {
    const [total, rows] = await Promise.all([
      this.repository.countStudents(query),
      this.repository.listStudents(query),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    return {
      items: rows.map((row) => this.mapStudentListRow(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasPrev: query.page > 1,
        hasNext: query.page < totalPages,
      },
    };
  }

  async getStudentById(studentId: string): Promise<{
    id: string;
    fullName: string;
    telegramUsername: string | null;
    telegramId: string | null;
    degree: "bachelor" | "master" | null;
    faculty: string | null;
    studentId: string | null;
    email: string | null;
    isProfileCompleted: boolean;
    registrationDate: string;
    updatedAt: string;
    lastActivityAt: string;
    totalAchievementsSubmitted: number;
    totalSubmissions: number;
    totalApprovedScore: number;
  }> {
    const row = await this.repository.findStudentById(studentId);
    if (!row) {
      throw new ServiceError(404, "Student not found");
    }
    return this.mapStudentDetailRow(row);
  }

  async updateStudentById(studentId: string, body: AdminUpdateStudentBody): Promise<{
    id: string;
    fullName: string;
    telegramUsername: string | null;
    telegramId: string | null;
    degree: "bachelor" | "master" | null;
    faculty: string | null;
    studentId: string | null;
    email: string | null;
    isProfileCompleted: boolean;
    registrationDate: string;
    updatedAt: string;
    lastActivityAt: string;
    totalAchievementsSubmitted: number;
    totalSubmissions: number;
    totalApprovedScore: number;
  }> {
    await this.repository.updateStudentById(studentId, body);
    const row = await this.repository.findStudentById(studentId);
    if (!row) {
      throw new ServiceError(404, "Student not found");
    }
    this.invalidateReadCaches();
    return this.mapStudentDetailRow(row);
  }

  private async buildSubmissionsList(query: AdminSubmissionsQuery): Promise<{
    items: ReturnType<AdminService["mapListRow"]>[];
    total: number;
    pendingCount: number;
    page: number;
    pageSize: number;
  }> {
    const pendingQuery: AdminSubmissionsQuery | null =
      query.status && query.status !== "pending" ? null : { ...query, status: "pending" };
    const [total, rows, pendingCount] = await Promise.all([
      this.repository.countSubmissions(query),
      this.repository.listSubmissions(query),
      pendingQuery ? this.repository.countSubmissions(pendingQuery) : Promise.resolve(0),
    ]);

    return {
      items: rows.map((r) => this.mapListRow(r)),
      total,
      pendingCount,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private mapListRow(row: AdminSubmissionListRow) {
    return {
      id: row.id,
      userId: row.user_id,
      studentId: row.student_id,
      categoryCode: row.category_code,
      categoryTitle: row.category_title,
      subcategorySlug: row.subcategory_slug,
      title: row.title,
      status: toModerationStatus(row.db_status),
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      score: numOrNull(row.score),
      ownerName: row.owner_name,
    };
  }

  private mapNeedsAttentionRow(row: AdminNeedsAttentionRow): {
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
  } {
    const waitingHours = Number(row.waiting_hours ?? "0");
    const waitingOver24h = waitingHours >= 24;
    let reason: "missing_proof_file" | "waiting_over_24h" | "manual_scoring_needed" | "oldest_pending" =
      "oldest_pending";
    if (row.missing_proof_file) {
      reason = "missing_proof_file";
    } else if (waitingOver24h) {
      reason = "waiting_over_24h";
    } else if (row.needs_manual_score) {
      reason = "manual_scoring_needed";
    }

    const identity = row.student_id?.trim() || row.student_name?.trim() || "Student";
    return {
      submissionId: row.submission_id,
      label: `${identity} • ${row.submission_title}`,
      studentId: row.student_id,
      studentName: row.student_name,
      title: row.submission_title,
      waitingHours,
      missingProofFile: row.missing_proof_file,
      waitingOver24h,
      needsManualScore: row.needs_manual_score,
      reason,
    };
  }

  private mapSearchSuggestionRow(row: AdminSearchSuggestionRow): {
    kind: AdminSearchSuggestionKind;
    value: string;
    label: string;
    meta: string | null;
  } {
    return {
      kind: row.kind,
      value: row.value,
      label: row.label,
      meta: row.meta,
    };
  }

  private mapStudentOverviewRow(row: AdminStudentOverviewRow): {
    userId: string;
    studentId: string;
    studentName: string | null;
    faculty: string | null;
    telegramUsername: string | null;
    totalSubmissions: number;
    pendingSubmissions: number;
    approvedSubmissions: number;
    rejectedSubmissions: number;
    totalApprovedScore: number;
  } {
    return {
      userId: row.user_id,
      studentId: row.student_id,
      studentName: row.student_name,
      faculty: row.faculty,
      telegramUsername: row.telegram_username,
      totalSubmissions: Number(row.total_submissions ?? "0"),
      pendingSubmissions: Number(row.pending_submissions ?? "0"),
      approvedSubmissions: Number(row.approved_submissions ?? "0"),
      rejectedSubmissions: Number(row.rejected_submissions ?? "0"),
      totalApprovedScore: Number(row.total_approved_score ?? "0"),
    };
  }

  private mapStudentListRow(row: AdminStudentListRow): {
    id: string;
    fullName: string;
    telegramUsername: string | null;
    telegramId: string | null;
    degree: "bachelor" | "master" | null;
    faculty: string | null;
    studentId: string | null;
    registrationDate: string;
    lastActivityAt: string;
    totalAchievementsSubmitted: number;
    totalApprovedScore: number;
  } {
    const fullName = row.student_full_name?.trim() || row.full_name?.trim() || "—";
    const degree =
      row.degree === "bachelor" || row.degree === "master" ? row.degree : null;
    return {
      id: row.id,
      fullName,
      telegramUsername: row.telegram_username,
      telegramId: row.telegram_id,
      degree,
      faculty: row.faculty,
      studentId: row.student_id,
      registrationDate: row.registration_date,
      lastActivityAt: row.last_activity_at,
      totalAchievementsSubmitted: Number(row.total_achievements_submitted ?? "0"),
      totalApprovedScore: Number(row.total_approved_score ?? "0"),
    };
  }

  private mapStudentDetailRow(row: AdminStudentDetailRow): {
    id: string;
    fullName: string;
    telegramUsername: string | null;
    telegramId: string | null;
    degree: "bachelor" | "master" | null;
    faculty: string | null;
    studentId: string | null;
    email: string | null;
    isProfileCompleted: boolean;
    registrationDate: string;
    updatedAt: string;
    lastActivityAt: string;
    totalAchievementsSubmitted: number;
    totalSubmissions: number;
    totalApprovedScore: number;
  } {
    const degree =
      row.degree === "bachelor" || row.degree === "master" ? row.degree : null;
    return {
      id: row.id,
      fullName: row.student_full_name?.trim() || row.full_name?.trim() || "—",
      telegramUsername: row.telegram_username,
      telegramId: row.telegram_id,
      degree,
      faculty: row.faculty,
      studentId: row.student_id,
      email: row.email,
      isProfileCompleted: row.is_profile_completed,
      registrationDate: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at,
      totalAchievementsSubmitted: Number(row.total_achievements_submitted ?? "0"),
      totalSubmissions: Number(row.total_submissions ?? "0"),
      totalApprovedScore: Number(row.total_approved_score ?? "0"),
    };
  }

  private mapActivitySummary(row: AdminActivitySummaryRow): {
    totalActions: number;
    approvals: number;
    rejects: number;
  } {
    return {
      totalActions: Number(row.total_actions ?? "0"),
      approvals: Number(row.approvals ?? "0"),
      rejects: Number(row.rejects ?? "0"),
    };
  }

  private mapActivityRow(row: AdminActivityRow): {
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
  } {
    return {
      id: row.activity_id,
      action: row.action,
      adminId: row.admin_id,
      adminName: row.admin_name,
      adminEmail: row.admin_email,
      studentId: row.student_id,
      studentName: row.student_name,
      submissionId: row.submission_id,
      submissionTitle: row.submission_title,
      submissionSubmittedAt: row.submission_submitted_at,
      createdAt: row.created_at,
    };
  }

  async getSubmissionDetail(submissionId: string): Promise<{
    submission: Record<string, unknown>;
    items: Record<string, unknown>[];
    itemModeration: {
      aggregateStatus: SubmissionItemAggregateStatus;
      pendingCount: number;
      approvedCount: number;
      rejectedCount: number;
      totalItems: number;
      approvedLinesTotalScore: number;
    };
    files: Record<string, unknown>[];
    link: string | null;
    user: Record<string, unknown> | null;
  }> {
    const submission = await this.repository.findSubmissionById(submissionId);
    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    const db = this.app.db;
    const [items, files, user] = await Promise.all([
      this.repository.listItemsForSubmission(db, submissionId),
      this.repository.listFilesForSubmission(db, submissionId),
      this.repository.findUserById(db, submission.user_id),
    ]);

    const primaryLink = items.map((it) => it.external_link).find((u) => u && u.trim().length > 0) ?? null;

    const [mappedItems, mappedFiles] = await Promise.all([
      Promise.all(items.map((it) => this.mapItemAsync(it))),
      Promise.all(files.map((f) => this.mapFileAsync(f))),
    ]);
    const itemModeration = this.computeItemModerationSummary(items);

    return {
      submission: this.mapSubmissionDetail(submission),
      items: mappedItems,
      itemModeration,
      files: mappedFiles,
      link: primaryLink,
      user: user ? this.mapUser(user) : null,
    };
  }

  async approveSubmission(
    submissionId: string,
    body: AdminApproveBody,
    actor: { actorUserId: string },
  ): Promise<Record<string, unknown>> {
    const client = await this.app.db.connect();
    let updated: AdminSubmissionDetailRow;
    let oldDbStatus: string;
    let targetUserId: string;
    let lineCount = 0;

    try {
      await client.query("BEGIN");

      const submission = await this.repository.findSubmissionForUpdate(client, submissionId);
      if (!submission) {
        throw new ServiceError(404, "Submission not found");
      }

      if (submission.db_status === "approved") {
        throw new ServiceError(409, "Submission is already approved");
      }

      if (!ADMIN_PROCESSABLE_STATUSES.has(submission.db_status)) {
        throw new ServiceError(
          409,
          `Only pending moderation submissions can be approved (current status: "${submission.db_status}")`,
        );
      }

      const items = await this.repository.listItemsForSubmission(client, submissionId);
      if (items.length === 0) {
        throw new ServiceError(400, "Submission has no line items to score");
      }

      lineCount = items.length;
      oldDbStatus = submission.db_status;
      targetUserId = submission.user_id;

      const scores = this.computeApproveItemScores(items, body);
      this.app.log.info(
        { submissionId, score: body.score ?? null, itemsCount: items.length },
        "admin moderation approve",
      );

      await this.repository.updateItemsApprove(client, submissionId, scores, actor.actorUserId);

      await this.repository.ensureSubmissionReadyForModerationFinalize(
        client,
        submissionId,
        submission.db_status,
      );

      updated = await this.repository.finalizeSubmission(client, {
        submissionId,
        status: "approved",
        reviewedByUserId: actor.actorUserId,
      });

      await client.query("COMMIT");
      this.invalidateReadCaches();
    } catch (error) {
      await client.query("ROLLBACK");
      this.app.log.error({ err: error, submissionId }, "approveSubmission failed");
      if (error instanceof ServiceError) {
        throw error;
      }
      const mapped = mapPgErrorToClient(error);
      if (mapped) {
        throw new ServiceError(mapped.status, mapped.message, mapped.code);
      }
      const message = error instanceof Error ? error.message : "Failed to approve submission";
      throw new ServiceError(500, message, "APPROVE_SUBMISSION_FAILED");
    } finally {
      client.release();
    }

    try {
      await this.audit.insert({
        actorUserId: actor.actorUserId,
        targetUserId,
        entityTable: "submissions",
        entityId: submissionId,
        action: "admin_moderation_approve",
        oldValues: { status: oldDbStatus },
        newValues: {
          status: "approved",
          scoreProvided: body.score ?? null,
          lineCount,
        },
      });

      this.notifications.notifySubmissionModerationResult({
        userId: targetUserId,
        submissionId,
        status: "approved",
        totalScore: Number(updated.total_score),
      });
    } catch (postErr) {
      this.app.log.error({ err: postErr, submissionId }, "approveSubmission post-commit failed");
    }

    return this.mapSubmissionDetail(updated);
  }

  /**
   * When admin omits total `score`, every line must have `proposed_score` or we reject.
   * When admin sends `score`, split evenly across items (ignore proposed for approval amounts).
   */
  private computeApproveItemScores(
    items: AdminItemRow[],
    body: AdminApproveBody,
  ): { itemId: string; approvedScore: number }[] {
    const hasExplicitTotal = body.score !== undefined && body.score !== null && Number.isFinite(body.score);

    if (!hasExplicitTotal) {
      const missingProposed = items.some((it) => numOrNull(it.proposed_score) === null);
      if (missingProposed) {
        throw new ServiceError(400, "Items missing proposed_score", "VALIDATION_ERROR");
      }
    }

    let perItemScore: number | null = null;
    if (hasExplicitTotal) {
      perItemScore = Number((Number(body.score) / items.length).toFixed(2));
      if (!Number.isFinite(perItemScore)) {
        throw new ServiceError(400, "Invalid total score", "VALIDATION_ERROR");
      }
    }

    return items.map((it) => ({
      itemId: it.id,
      approvedScore: perItemScore !== null ? perItemScore : (numOrNull(it.proposed_score) ?? 0),
    }));
  }

  async rejectSubmission(
    submissionId: string,
    body: AdminRejectBody,
    actor: { actorUserId: string },
  ): Promise<Record<string, unknown>> {
    const client = await this.app.db.connect();
    let updated: AdminSubmissionDetailRow;
    let oldDbStatus: string;
    let targetUserId: string;

    try {
      await client.query("BEGIN");

      const submission = await this.repository.findSubmissionForUpdate(client, submissionId);
      if (!submission) {
        throw new ServiceError(404, "Submission not found");
      }

      if (submission.db_status === "rejected") {
        throw new ServiceError(409, "Submission is already rejected");
      }

      if (submission.db_status === "approved") {
        throw new ServiceError(409, "An approved submission cannot be rejected through this action");
      }

      if (!ADMIN_PROCESSABLE_STATUSES.has(submission.db_status)) {
        throw new ServiceError(
          409,
          `Only pending moderation submissions can be rejected (current status: "${submission.db_status}")`,
        );
      }

      oldDbStatus = submission.db_status;
      targetUserId = submission.user_id;

      const rejectItems = await this.repository.listItemsForSubmission(client, submissionId);
      if (rejectItems.length === 0) {
        throw new ServiceError(400, "Submission has no line items to reject");
      }

      await this.repository.updateItemsRejectAll(client, submissionId, actor.actorUserId);

      await this.repository.ensureSubmissionReadyForModerationFinalize(
        client,
        submissionId,
        submission.db_status,
      );

      updated = await this.repository.finalizeSubmission(client, {
        submissionId,
        status: "rejected",
        reviewedByUserId: actor.actorUserId,
      });

      await client.query("COMMIT");
      this.invalidateReadCaches();
    } catch (error) {
      await client.query("ROLLBACK");
      this.app.log.error({ err: error, submissionId }, "rejectSubmission failed");
      if (error instanceof ServiceError) {
        throw error;
      }
      const mapped = mapPgErrorToClient(error);
      if (mapped) {
        throw new ServiceError(mapped.status, mapped.message, mapped.code);
      }
      const message = error instanceof Error ? error.message : "Failed to reject submission";
      throw new ServiceError(500, message, "REJECT_SUBMISSION_FAILED");
    } finally {
      client.release();
    }

    try {
      await this.audit.insert({
        actorUserId: actor.actorUserId,
        targetUserId,
        entityTable: "submissions",
        entityId: submissionId,
        action: "admin_moderation_reject",
        oldValues: { status: oldDbStatus },
        newValues: { status: "rejected", reason: body.reason ?? null },
      });

      this.notifications.notifySubmissionModerationResult({
        userId: targetUserId,
        submissionId,
        status: "rejected",
        rejectReason: body.reason,
      });
    } catch (postErr) {
      this.app.log.error({ err: postErr, submissionId }, "rejectSubmission post-commit failed");
    }

    return this.mapSubmissionDetail(updated);
  }

  private mapSubmissionDetail(row: AdminSubmissionDetailRow) {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      description: row.description,
      status: toModerationStatus(row.db_status),
      workflowStatus: row.db_status,
      totalPoints: Number(row.total_score),
      submittedAt: row.submitted_at,
      reviewedAt: row.reviewed_at,
      reviewedById: row.reviewed_by,
      reviewerEmail: row.reviewed_by_email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getPublicUrlForObjectPath(storagePath: string, bucket: string): string {
    const { data } = this.app.supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
    return data.publicUrl;
  }

  /** Prefer signed URLs so private buckets work in the admin browser; fall back to public URL. */
  private async displayUrlForStoragePath(objectPath: string): Promise<string> {
    const bucket = env.STORAGE_BUCKET;
    const signed = await this.app.supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(objectPath, env.STORAGE_SIGNED_URL_TTL_SECONDS);
    if (!signed.error && signed.data?.signedUrl) {
      return signed.data.signedUrl;
    }
    this.app.log.warn({ err: signed.error, objectPath }, "Signed URL failed for admin file; using public URL");
    return this.getPublicUrlForObjectPath(objectPath, bucket);
  }

  private async resolveItemProofFileUrlAsync(
    proof: string | null,
    submissionOwnerUserId: string,
  ): Promise<string | null> {
    if (!proof?.trim()) {
      return null;
    }
    const t = proof.trim();

    if (/^https?:\/\//i.test(t)) {
      const extracted = extractStoragePathFromSupabasePublicUrl(t);
      if (extracted !== null) {
        const path = normalizeLegacyStorageObjectPath(extracted);
        return this.displayUrlForStoragePath(path);
      }
      return t;
    }

    let path: string;
    if (!t.includes("/")) {
      path = `${submissionOwnerUserId}/${t}`;
    } else {
      path = normalizeLegacyStoragePathForRead(t, submissionOwnerUserId);
    }
    path = normalizeLegacyStorageObjectPath(path);
    return this.displayUrlForStoragePath(path);
  }

  private async resolveFilesRowPublicUrlAsync(row: AdminFileRow): Promise<string | null> {
    const stored = row.file_url?.trim();
    if (stored && /^https?:\/\//i.test(stored)) {
      const extracted = extractStoragePathFromSupabasePublicUrl(stored);
      if (extracted !== null) {
        const path = normalizeLegacyStorageObjectPath(extracted);
        return this.displayUrlForStoragePath(path);
      }
      return stored;
    }
    if (!row.storage_path?.trim()) {
      return stored ?? null;
    }
    const path = normalizeLegacyStorageObjectPath(row.storage_path.trim());
    return this.displayUrlForStoragePath(path);
  }

  private async mapItemAsync(row: AdminItemRow): Promise<Record<string, unknown>> {
    const categoryTitle = row.category_title ?? row.category_name;
    return {
      id: row.id,
      submissionId: row.submission_id,
      title: row.title,
      description: row.description,
      proofFileUrl: await this.resolveItemProofFileUrlAsync(row.proof_file_url, row.submission_user_id),
      externalLink: row.external_link,
      proposedScore: numOrNull(row.proposed_score),
      approvedScore: numOrNull(row.approved_score),
      reviewerComment: row.reviewer_comment,
      status: normalizeItemModerationStatus(row.status),
      reviewedById: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      categoryCode: row.category_code,
      categoryName: row.category_name,
      categoryTitle,
      subcategorySlug: row.subcategory_slug,
      subcategoryLabel: row.subcategory_label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private computeItemModerationSummary(items: AdminItemRow[]): {
    aggregateStatus: SubmissionItemAggregateStatus;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
    totalItems: number;
    approvedLinesTotalScore: number;
  } {
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let approvedLinesTotalScore = 0;

    for (const item of items) {
      const status = normalizeItemModerationStatus(item.status);
      if (status === "pending") {
        pendingCount += 1;
      } else if (status === "approved") {
        approvedCount += 1;
        approvedLinesTotalScore += numOrNull(item.approved_score) ?? 0;
      } else {
        rejectedCount += 1;
      }
    }

    const totalItems = items.length;
    let aggregateStatus: SubmissionItemAggregateStatus = "pending";
    if (totalItems > 0 && pendingCount === 0) {
      if (approvedCount === totalItems) {
        aggregateStatus = "approved";
      } else if (rejectedCount === totalItems) {
        aggregateStatus = "rejected";
      } else if (approvedCount > 0 && rejectedCount > 0) {
        aggregateStatus = "partially_approved";
      }
    }

    return {
      aggregateStatus,
      pendingCount,
      approvedCount,
      rejectedCount,
      totalItems,
      approvedLinesTotalScore: Number(approvedLinesTotalScore.toFixed(2)),
    };
  }

  private async mapFileAsync(row: AdminFileRow): Promise<Record<string, unknown>> {
    return {
      id: row.id,
      submissionId: row.submission_id,
      submissionItemId: row.submission_item_id,
      fileUrl: await this.resolveFilesRowPublicUrlAsync(row),
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      createdAt: row.created_at,
    };
  }

  private mapUser(row: AdminUserRow) {
    return {
      studentFullName: row.student_full_name,
      faculty: row.faculty,
      studentId: row.student_id,
      telegramUsername: row.telegram_username,
    };
  }
}
