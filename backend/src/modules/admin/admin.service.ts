import type { FastifyInstance } from "fastify";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import { ServiceError } from "../../utils/service-error";
import type {
  AdminFileRow,
  AdminItemRow,
  AdminSubmissionDetailRow,
  AdminSubmissionListRow,
  AdminUserRow,
} from "./admin.repository";
import { AdminRepository } from "./admin.repository";
import type {
  AdminApproveBody,
  AdminModerationStatus,
  AdminRejectBody,
  AdminSubmissionsQuery,
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

function splitTotalAcrossItems(total: number, count: number): number[] {
  if (count <= 0) {
    return [];
  }
  const cents = Math.round(total * 100);
  const baseCents = Math.floor(cents / count);
  const remainder = cents - baseCents * count;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    let c = baseCents;
    if (i < remainder) {
      c += 1;
    }
    out.push(c / 100);
  }
  return out;
}

function numOrNull(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class AdminService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly repository: AdminRepository,
    private readonly audit: AuditLogRepository,
    private readonly notifications: NotificationService,
  ) {}

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

  async listSubmissions(query: AdminSubmissionsQuery): Promise<{
    items: ReturnType<AdminService["mapListRow"]>[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [total, rows] = await Promise.all([
      this.repository.countSubmissions(query),
      this.repository.listSubmissions(query),
    ]);

    return {
      items: rows.map((r) => this.mapListRow(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private mapListRow(row: AdminSubmissionListRow) {
    return {
      id: row.id,
      userId: row.user_id,
      categoryCode: row.category_code,
      subcategorySlug: row.subcategory_slug,
      title: row.title,
      status: toModerationStatus(row.db_status),
      createdAt: row.created_at,
      proposedScore: numOrNull(row.proposed_score),
      ownerEmail: row.owner_email,
      ownerName: row.owner_name,
    };
  }

  async getSubmissionDetail(submissionId: string): Promise<{
    submission: Record<string, unknown>;
    items: Record<string, unknown>[];
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

    return {
      submission: this.mapSubmissionDetail(submission),
      items: items.map((it) => this.mapItem(it)),
      files: files.map((f) => this.mapFile(f)),
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

      const scores = this.resolveApprovedScores(items, body);
      await this.repository.updateItemsApprove(client, submissionId, scores);

      const updated = await this.repository.finalizeSubmission(client, {
        submissionId,
        status: "approved",
      });

      await client.query("COMMIT");

      await this.audit.insert({
        actorUserId: actor.actorUserId,
        targetUserId: submission.user_id,
        entityTable: "submissions",
        entityId: submissionId,
        action: "admin_moderation_approve",
        oldValues: { status: submission.db_status },
        newValues: {
          status: "approved",
          scoreProvided: body.score ?? null,
          lineCount: items.length,
        },
      });

      this.notifications.notifySubmissionStatusChanged({
        userId: submission.user_id,
        submissionId,
        status: "approved",
      });

      return this.mapSubmissionDetail(updated);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private resolveApprovedScores(
    items: AdminItemRow[],
    body: AdminApproveBody,
  ): { itemId: string; approvedScore: number }[] {
    if (body.score === undefined) {
      return items.map((it) => {
        const proposed = numOrNull(it.proposed_score);
        if (proposed === null) {
          throw new ServiceError(
            400,
            "Every line item must have a proposed score when the admin score is omitted",
          );
        }
        return { itemId: it.id, approvedScore: proposed };
      });
    }

    const parts = splitTotalAcrossItems(body.score, items.length);
    return items.map((it, idx) => ({
      itemId: it.id,
      approvedScore: parts[idx] ?? 0,
    }));
  }

  async rejectSubmission(
    submissionId: string,
    body: AdminRejectBody,
    actor: { actorUserId: string },
  ): Promise<Record<string, unknown>> {
    const client = await this.app.db.connect();
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

      await this.repository.updateItemsRejectAll(client, submissionId);
      const updated = await this.repository.finalizeSubmission(client, {
        submissionId,
        status: "rejected",
      });

      await client.query("COMMIT");

      await this.audit.insert({
        actorUserId: actor.actorUserId,
        targetUserId: submission.user_id,
        entityTable: "submissions",
        entityId: submissionId,
        action: "admin_moderation_reject",
        oldValues: { status: submission.db_status },
        newValues: { status: "rejected", reason: body.reason ?? null },
      });

      this.notifications.notifySubmissionStatusChanged({
        userId: submission.user_id,
        submissionId,
        status: "rejected",
      });

      return this.mapSubmissionDetail(updated);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapItem(row: AdminItemRow) {
    return {
      id: row.id,
      submissionId: row.submission_id,
      title: row.title,
      description: row.description,
      proofFileUrl: row.proof_file_url,
      externalLink: row.external_link,
      proposedScore: numOrNull(row.proposed_score),
      approvedScore: numOrNull(row.approved_score),
      status: row.status,
      categoryCode: row.category_code,
      categoryName: row.category_name,
      subcategorySlug: row.subcategory_slug,
      subcategoryLabel: row.subcategory_label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapFile(row: AdminFileRow) {
    return {
      id: row.id,
      submissionId: row.submission_id,
      submissionItemId: row.submission_item_id,
      fileUrl: row.file_url,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      createdAt: row.created_at,
    };
  }

  private mapUser(row: AdminUserRow) {
    return {
      id: row.id,
      email: row.email,
      studentFullName: row.student_full_name,
      faculty: row.faculty,
      studentId: row.student_id,
      telegramUsername: row.telegram_username,
    };
  }
}
