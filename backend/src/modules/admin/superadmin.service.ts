import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import { ServiceError } from "../../utils/service-error";
import type {
  SuperadminActivityPdfQuery,
  SuperadminAuditQuery,
  SuperadminListQuery,
  SuperadminSecurityQuery,
} from "./superadmin.schema";
import {
  ActivityReportPdfService,
  buildActivityPdfFilename,
  normalizeDisplayDateTime,
} from "./activity-report-pdf.service";
import { SuperadminRepository } from "./superadmin.repository";

function toNum(value: string | null | undefined): number {
  const n = Number(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

export class SuperadminService {
  private static readonly HIDDEN_ADMIN_EMAILS = new Set([
    "kamolovmuhsin@icloud.com",
    "kamolovmuhsin@iclod.com",
  ]);
  private readonly repository: SuperadminRepository;
  private readonly pdfService: ActivityReportPdfService;

  constructor(
    private readonly app: FastifyInstance,
    private readonly audit: AuditLogRepository,
    private readonly notifications: NotificationService,
  ) {
    this.repository = new SuperadminRepository(app);
    this.pdfService = new ActivityReportPdfService();
  }

  async getDashboard(viewerUserId?: string): Promise<{
    pendingQueue: number;
    processed7d: number;
    avgReviewMinutes: number;
    activeAdminsToday: number;
    securityAlertsCount: number;
    overloadedQueue: boolean;
    alerts: Array<{ code: string; message: string; severity: "warning" | "critical" }>;
    pendingRegistrationRequests: Array<{
      eventId: string;
      adminId: string;
      adminName: string | null;
      adminEmail: string | null;
      createdAt: string;
    }>;
  }> {
    const includeHidden = await this.canViewHiddenAdmin(viewerUserId);
    const [row, pendingRequests] = await Promise.all([
      this.repository.getSuperDashboardSummary(includeHidden),
      this.repository.listPendingAdminRegistrationRequests(6, includeHidden),
    ]);
    const pendingQueue = toNum(row.pending_queue);
    const securityAlertsCount = toNum(row.security_alerts_count);
    const activeAdminsToday = toNum(row.active_admins_today);
    const overloadedQueue = pendingQueue > 20;
    const alerts: Array<{ code: string; message: string; severity: "warning" | "critical" }> = [];
    if (securityAlertsCount > 0) {
      alerts.push({
        code: "security_events_pending",
        message: `${securityAlertsCount} unresolved security event(s).`,
        severity: "critical",
      });
    }
    if (overloadedQueue) {
      alerts.push({
        code: "queue_overloaded",
        message: `Queue overload detected: ${pendingQueue} pending submissions.`,
        severity: "warning",
      });
    }
    if (activeAdminsToday === 0) {
      alerts.push({
        code: "admins_inactive_today",
        message: "No admin login recorded today.",
        severity: "warning",
      });
    }

    return {
      pendingQueue,
      processed7d: toNum(row.processed_7d),
      avgReviewMinutes: toNum(row.avg_review_minutes),
      activeAdminsToday,
      securityAlertsCount,
      overloadedQueue,
      alerts,
      pendingRegistrationRequests: pendingRequests.map((request) => ({
        eventId: request.event_id,
        adminId: request.admin_id,
        adminName: request.admin_name,
        adminEmail: request.admin_email,
        createdAt: request.created_at,
      })),
    };
  }

  async listAdmins(query: SuperadminListQuery, viewerUserId?: string) {
    const includeHidden = await this.canViewHiddenAdmin(viewerUserId);
    const [total, rows] = await Promise.all([
      this.repository.countAdmins(query, includeHidden),
      this.repository.listAdmins(query, includeHidden),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.full_name,
        email: r.email,
        role: r.role,
        status: r.status,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        lastLoginIp: r.last_login_ip,
        approvals: toNum(r.approvals),
        rejects: toNum(r.rejects),
        avgReviewMinutes: toNum(r.avg_review_minutes),
      })),
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

  async getAdminDetail(adminId: string, query: SuperadminListQuery, viewerUserId?: string) {
    const includeHidden = await this.canViewHiddenAdmin(viewerUserId);
    const [identity, stats, totalActivity, activity, sessions] = await Promise.all([
      this.repository.findAdminIdentity(adminId, includeHidden),
      this.repository.getAdminStats(adminId),
      this.repository.countAdminRecentActivity(adminId),
      this.repository.listAdminRecentActivity(adminId, query.page, query.pageSize),
      this.repository.listAdminSessions(adminId),
    ]);
    if (!identity) {
      throw new ServiceError(404, "Admin not found");
    }
    const totalPages = Math.max(1, Math.ceil(totalActivity / query.pageSize));
    return {
      identity: {
        id: identity.id,
        fullName: identity.full_name,
        email: identity.email,
        role: identity.role,
        status: identity.status,
        createdAt: identity.created_at,
        suspendedAt: identity.suspended_at,
        suspensionReason: identity.suspension_reason,
        lastLoginAt: identity.last_login_at,
        lastLoginIp: identity.last_login_ip,
      },
      stats: {
        approvals: toNum(stats.approvals),
        rejects: toNum(stats.rejects),
        avgReviewMinutes: toNum(stats.avg_review_minutes),
      },
      recentActivity: activity.map((a) => ({
        id: a.id,
        action: a.action,
        targetTable: a.target_table,
        targetId: a.target_id,
        createdAt: a.created_at,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        revokedAt: s.revoked_at,
      })),
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

  async changeAdminRole(input: {
    targetAdminId: string;
    role: "admin" | "superadmin";
    actorUserId: string;
  }): Promise<void> {
    const target = await this.repository.findAdminIdentity(input.targetAdminId);
    if (!target) {
      throw new ServiceError(404, "Admin not found");
    }
    if (input.targetAdminId === input.actorUserId && target.role === "superadmin" && input.role !== "superadmin") {
      throw new ServiceError(403, "You cannot downgrade your own superadmin account");
    }
    if (target.role === "superadmin" && input.role === "admin") {
      const superCount = await this.repository.countSuperadmins();
      if (superCount <= 1) {
        throw new ServiceError(409, "Cannot downgrade the last superadmin");
      }
    }
    await this.repository.updateAdminRole(input.targetAdminId, input.role);
    await this.audit.insert({
      actorUserId: input.actorUserId,
      targetUserId: input.targetAdminId,
      entityTable: "admin_users",
      entityId: input.targetAdminId,
      action: "role_changed",
      oldValues: { role: target.role },
      newValues: { role: input.role },
    });
    this.notifications.notifySuperadminsSecurityAlert(
      `Superadmin action: role changed for admin ${input.targetAdminId} (${target.role} -> ${input.role}).`,
    );
  }

  async changeAdminStatus(input: {
    targetAdminId: string;
    status: "active" | "suspended";
    reason?: string;
    actorUserId: string;
  }): Promise<void> {
    const target = await this.repository.findAdminIdentity(input.targetAdminId);
    if (!target) {
      throw new ServiceError(404, "Admin not found");
    }
    if (input.targetAdminId === input.actorUserId && target.role === "superadmin" && input.status === "suspended") {
      throw new ServiceError(403, "You cannot suspend your own superadmin account");
    }
    if (target.role === "superadmin" && input.status === "suspended") {
      const superCount = await this.repository.countSuperadmins();
      if (superCount <= 1) {
        throw new ServiceError(409, "Cannot suspend the last superadmin");
      }
    }
    await this.repository.updateAdminStatus(input.targetAdminId, {
      status: input.status,
      suspendedBy: input.actorUserId,
      reason: input.reason,
    });
    await this.audit.insert({
      actorUserId: input.actorUserId,
      targetUserId: input.targetAdminId,
      entityTable: "admin_users",
      entityId: input.targetAdminId,
      action: input.status === "suspended" ? "admin_suspended" : "admin_unsuspended",
      oldValues: { status: target.status },
      newValues: { status: input.status, reason: input.reason ?? null },
    });
  }

  async resetAdminPassword(input: { targetAdminId: string; actorUserId: string; temporaryPassword?: string }) {
    const email = await this.repository.findAdminEmail(input.targetAdminId);
    if (!email) {
      throw new ServiceError(404, "Admin email not found");
    }
    const temporaryPassword = input.temporaryPassword ?? randomBytes(12).toString("base64url");
    const { error } = await this.app.supabaseAdmin.auth.admin.updateUserById(input.targetAdminId, {
      password: temporaryPassword,
      user_metadata: { must_change_password: true },
    });
    if (error) {
      throw new ServiceError(502, `Password reset failed: ${error.message}`);
    }
    await this.audit.insert({
      actorUserId: input.actorUserId,
      targetUserId: input.targetAdminId,
      entityTable: "admin_users",
      entityId: input.targetAdminId,
      action: "password_reset",
      metadata: { temporaryPasswordIssued: true },
    });
    return { temporaryPassword, email };
  }

  async listAuditLogs(query: SuperadminAuditQuery, viewerUserId?: string) {
    const includeHidden = await this.canViewHiddenAdmin(viewerUserId);
    const [total, rows] = await Promise.all([
      this.repository.countAuditLogs(query, includeHidden),
      this.repository.listAuditLogs(query, includeHidden),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    return {
      items: rows.map((r) => ({
        id: r.id,
        time: r.created_at,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        action: r.action,
        targetTable: r.target_table,
        targetId: r.target_id,
        targetName: r.target_name,
        targetEmail: r.target_email,
        targetTitle: r.submission_title,
        details: r.metadata,
        oldValues: r.old_values,
        newValues: r.new_values,
        ip: r.request_ip,
      })),
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

  async listSecurityEvents(query: SuperadminSecurityQuery, viewerUserId?: string) {
    const includeHidden = await this.canViewHiddenAdmin(viewerUserId);
    const registrationOnlyQuery: SuperadminSecurityQuery = {
      ...query,
      type: "admin_registration",
    };
    const [total, rows] = await Promise.all([
      this.repository.countSecurityEvents(registrationOnlyQuery, includeHidden),
      this.repository.listSecurityEvents(registrationOnlyQuery, includeHidden),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    return {
      items: rows.map((r) => ({
        id: r.id,
        adminId: r.admin_id,
        adminName: r.admin_name,
        adminEmail: r.admin_email,
        type: r.type,
        status: r.status,
        metadata: r.metadata,
        approvedBy: r.approved_by,
        approvedAt: r.approved_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
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

  async resolveSecurityEvent(input: {
    eventId: string;
    status: "approved" | "rejected";
    actorUserId: string;
  }): Promise<void> {
    const client = await this.app.db.connect();
    let resolvedAdminId: string | null = null;
    let resolvedAdminEmail: string | null = null;
    try {
      await client.query("BEGIN");
      const eventResult = await client.query<{
        admin_id: string;
        admin_email: string | null;
        type: "new_device_login" | "logout_others_request" | "admin_registration";
      }>(
        `
        SELECT
          ase.admin_id::text AS admin_id,
          u.email::text AS admin_email,
          ase.type::text AS type
        FROM public.admin_security_events ase
        INNER JOIN public.users u ON u.id = ase.admin_id
        WHERE ase.id = $1::uuid
          AND ase.status = 'pending'
        FOR UPDATE OF ase
        `,
        [input.eventId],
      );
      const eventRow = eventResult.rows[0];
      if (!eventRow) {
        throw new ServiceError(404, "Pending security event not found");
      }
      resolvedAdminId = eventRow.admin_id;
      resolvedAdminEmail = eventRow.admin_email ?? null;

      await client.query(
        `
        UPDATE public.admin_security_events
        SET
          status = $2,
          approved_by = $3::uuid,
          approved_at = NOW(),
          updated_at = NOW()
        WHERE id = $1::uuid
        `,
        [input.eventId, input.status, input.actorUserId],
      );

      if (eventRow.type === "admin_registration") {
        if (input.status === "approved") {
          await client.query(
            `
            UPDATE public.users
            SET role = 'admin', updated_at = NOW()
            WHERE id = $1::uuid
            `,
            [eventRow.admin_id],
          );
          await client.query(
            `
            INSERT INTO public.admin_users (id, email, role, status, created_at)
            SELECT u.id, u.email, 'admin', 'active', COALESCE(u.created_at, NOW())
            FROM public.users u
            WHERE u.id = $1::uuid
            ON CONFLICT ON CONSTRAINT admin_users_pkey DO UPDATE SET
              email = EXCLUDED.email,
              role = CASE
                WHEN public.admin_users.role::text = 'superadmin' THEN public.admin_users.role
                ELSE 'admin'
              END,
              status = 'active',
              suspended_at = NULL,
              suspended_by = NULL,
              suspension_reason = NULL
            `,
            [eventRow.admin_id],
          );
        } else {
          await client.query(
            `
            UPDATE public.users
            SET role = 'student', updated_at = NOW()
            WHERE id = $1::uuid
            `,
            [eventRow.admin_id],
          );
          await client.query(
            `
            DELETE FROM public.admin_users
            WHERE id = $1::uuid
              AND role::text <> 'superadmin'
            `,
            [eventRow.admin_id],
          );
          await client.query(
            `
            UPDATE public.admin_sessions
            SET revoked_at = NOW(), last_seen_at = NOW()
            WHERE admin_id = $1::uuid
              AND revoked_at IS NULL
            `,
            [eventRow.admin_id],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.audit.insert({
      actorUserId: input.actorUserId,
      targetUserId: resolvedAdminId,
      entityTable: "admin_security_events",
      entityId: input.eventId,
      action: input.status === "approved" ? "security_event_approved" : "security_event_rejected",
      newValues: {
        page: "security",
        targetEmail: resolvedAdminEmail,
        result: input.status,
      },
    });
  }

  async revokeAdminSessions(input: { targetAdminId: string; actorUserId: string }): Promise<{ revokedCount: number }> {
    const revokedCount = await this.repository.revokeSessionsForAdmin(input.targetAdminId);
    await this.audit.insert({
      actorUserId: input.actorUserId,
      targetUserId: input.targetAdminId,
      entityTable: "admin_sessions",
      entityId: input.targetAdminId,
      action: "session_revoked",
      metadata: { revokedCount },
    });
    return { revokedCount };
  }

  async assignSubmission(input: {
    submissionId: string;
    targetAdminId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.repository.assignSubmission(input.submissionId, input.targetAdminId);
    await this.audit.insert({
      actorUserId: input.actorUserId,
      targetUserId: input.targetAdminId,
      entityTable: "submissions",
      entityId: input.submissionId,
      action: "submission_assigned",
      metadata: { assignedAdminId: input.targetAdminId },
    });
  }

  async addSubmissionNote(input: {
    submissionId: string;
    actorUserId: string;
    note: string;
  }): Promise<void> {
    await this.repository.addAdminNote(input.submissionId, input.actorUserId, input.note);
    await this.audit.insert({
      actorUserId: input.actorUserId,
      entityTable: "admin_notes",
      entityId: input.submissionId,
      action: "admin_note_added",
      metadata: { noteLength: input.note.length },
    });
  }

  listSubmissionNotes(submissionId: string) {
    return this.repository.listAdminNotes(submissionId);
  }

  async exportActivityReportPdf(
    query: SuperadminActivityPdfQuery,
    actorUserId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const includeHidden = await this.canViewHiddenAdmin(actorUserId);
    const now = new Date();
    const range = this.resolveRange(query, now);
    const rows = await this.repository.listActivityReportRows({
      from: range.from,
      to: range.to,
      adminId: query.adminId,
      includeHidden: false,
    });
    const selectedAdmin =
      query.adminId ? await this.repository.findAdminIdentity(query.adminId, includeHidden) : null;
    const selectedAdminLabel = selectedAdmin
      ? selectedAdmin.email ??
        selectedAdmin.full_name ??
        query.adminId ??
        "All admins"
      : "All admins";
    const actor = await this.repository.findAdminIdentity(actorUserId);
    const generatedBy =
      actor?.email ?? actor?.full_name ?? actorUserId;
    const generatedAtIso = normalizeDisplayDateTime(now.toISOString());
    const buffer = await this.pdfService.render({
      generatedAtIso,
      generatedBy,
      filters: {
        range: query.range,
        from: normalizeDisplayDateTime(range.from),
        to: normalizeDisplayDateTime(range.to),
        adminLabel: selectedAdminLabel,
      },
      rows,
    });
    return {
      buffer,
      filename: buildActivityPdfFilename(now),
    };
  }

  async updateLastLogin(adminId: string, ip: string | null): Promise<void> {
    await this.repository.updateAdminLastLogin(adminId, ip);
  }

  private async canViewHiddenAdmin(viewerUserId?: string): Promise<boolean> {
    if (!viewerUserId) {
      return false;
    }
    const email = await this.repository.findAdminEmail(viewerUserId);
    const normalized = email?.trim().toLowerCase() ?? "";
    return SuperadminService.HIDDEN_ADMIN_EMAILS.has(normalized);
  }

  private resolveRange(
    query: SuperadminActivityPdfQuery,
    now: Date,
  ): { from: string; to: string } {
    if (query.range === "custom") {
      const from = new Date(query.from as string);
      const to = new Date(query.to as string);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new ServiceError(400, "Invalid custom date range", "VALIDATION_ERROR");
      }
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (query.range === "today") {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      const to = new Date(now);
      to.setHours(23, 59, 59, 999);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (query.range === "thisMonth") {
      const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
}
