import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import { ServiceError } from "../../utils/service-error";
import type { SuperadminAuditQuery, SuperadminListQuery, SuperadminSecurityQuery } from "./superadmin.schema";
import { SuperadminRepository } from "./superadmin.repository";

function toNum(value: string | null | undefined): number {
  const n = Number(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function toCsv(rows: Array<Record<string, string | number | null>>): string {
  if (rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: string | number | null): string => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h] ?? null)).join(","));
  }
  return lines.join("\n");
}

export class SuperadminService {
  private readonly repository: SuperadminRepository;

  constructor(
    private readonly app: FastifyInstance,
    private readonly audit: AuditLogRepository,
    private readonly notifications: NotificationService,
  ) {
    this.repository = new SuperadminRepository(app);
  }

  async getDashboard(): Promise<{
    pendingQueue: number;
    processed7d: number;
    avgReviewMinutes: number;
    activeAdminsToday: number;
    securityAlertsCount: number;
    overloadedQueue: boolean;
    alerts: Array<{ code: string; message: string; severity: "warning" | "critical" }>;
  }> {
    const row = await this.repository.getSuperDashboardSummary();
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
    };
  }

  async listAdmins(query: SuperadminListQuery) {
    const [total, rows] = await Promise.all([this.repository.countAdmins(query), this.repository.listAdmins(query)]);
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

  async getAdminDetail(adminId: string, query: SuperadminListQuery) {
    const [identity, stats, totalActivity, activity, sessions] = await Promise.all([
      this.repository.findAdminIdentity(adminId),
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

  async listAuditLogs(query: SuperadminAuditQuery) {
    const [total, rows] = await Promise.all([this.repository.countAuditLogs(query), this.repository.listAuditLogs(query)]);
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
        details: r.metadata,
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

  async listSecurityEvents(query: SuperadminSecurityQuery) {
    const [total, rows] = await Promise.all([
      this.repository.countSecurityEvents(query),
      this.repository.listSecurityEvents(query),
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
    const ok = await this.repository.resolveSecurityEvent(input.eventId, input.status, input.actorUserId);
    if (!ok) {
      throw new ServiceError(404, "Pending security event not found");
    }
    await this.audit.insert({
      actorUserId: input.actorUserId,
      entityTable: "admin_security_events",
      entityId: input.eventId,
      action: input.status === "approved" ? "security_event_approved" : "security_event_rejected",
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

  async exportModerationPerformanceCsv(from: string, to: string): Promise<string> {
    const rows = await this.repository.getModerationReportRows(from, to);
    return toCsv(rows);
  }

  async exportAdminProductivityCsv(from: string, to: string): Promise<string> {
    const rows = await this.repository.getAdminProductivityRows(from, to);
    return toCsv(rows);
  }

  async exportApprovalSummaryCsv(from: string, to: string): Promise<string> {
    const rows = await this.repository.getApprovalSummaryRows(from, to);
    return toCsv(rows);
  }

  async exportAuditCsv(from: string, to: string): Promise<string> {
    const rows = await this.repository.getAuditExportRows(from, to);
    return toCsv(rows);
  }

  async updateLastLogin(adminId: string, ip: string | null): Promise<void> {
    await this.repository.updateAdminLastLogin(adminId, ip);
  }
}
