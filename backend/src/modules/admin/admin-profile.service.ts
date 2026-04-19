import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import type { AdminProfileQuery } from "./admin-profile.schema";
import { AdminProfileRepository } from "./admin-profile.repository";
import { ServiceError } from "../../utils/service-error";

function toNumber(v: string | null | undefined): number {
  const n = Number(v ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function buildPermissions(role: "admin" | "superadmin"): {
  approveSubmissions: boolean;
  rejectSubmissions: boolean;
  exportCsv: boolean;
  manageAdmins: boolean;
  viewGlobalAuditLogs: boolean;
  securityApprovals: boolean;
} {
  const isSuperadmin = role === "superadmin";
  return {
    approveSubmissions: true,
    rejectSubmissions: true,
    exportCsv: true,
    manageAdmins: isSuperadmin,
    viewGlobalAuditLogs: isSuperadmin,
    securityApprovals: isSuperadmin,
  };
}

function fingerprintFromSignals(userAgent: string | null, ip: string | null): string {
  const payload = `${userAgent ?? ""}|${ip ?? ""}`;
  return createHash("sha256").update(payload).digest("hex");
}

function readClientIp(requestIp: string): string | null {
  const value = requestIp.trim();
  return value.length > 0 ? value : null;
}

export class AdminProfileService {
  private readonly repository: AdminProfileRepository;

  constructor(
    private readonly app: FastifyInstance,
    private readonly notifications: NotificationService,
    private readonly audit: AuditLogRepository,
  ) {
    this.repository = new AdminProfileRepository(app);
  }

  async getProfile(input: {
    adminId: string;
    query: AdminProfileQuery;
    sessionToken: string;
    requestIp: string;
    userAgent: string | null;
  }): Promise<{
    identity: {
      fullName: string;
      email: string | null;
      role: "admin" | "superadmin";
      adminCode: string;
      joinedAt: string | null;
      lastLoginAt: string | null;
      lastLoginIp: string | null;
      lastLoginUserAgent: string | null;
    };
    permissions: ReturnType<typeof buildPermissions>;
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
  }> {
    const ip = readClientIp(input.requestIp);
    const sessionToken = input.sessionToken.trim();
    if (!sessionToken) {
      throw new ServiceError(400, "Missing admin session token", "VALIDATION_ERROR");
    }

    const identity = await this.repository.findIdentity(input.adminId);
    if (!identity) {
      throw new ServiceError(404, "Admin account not found");
    }

    await this.ensureSession({
      adminId: input.adminId,
      sessionToken,
      ip,
      userAgent: input.userAgent,
      displayName: identity.full_name ?? identity.email ?? "Admin",
    });

    const [stats, total, actions, sessions, activeSessionsCount, restricted, pendingEvents] = await Promise.all([
      this.repository.getStats(input.adminId),
      this.repository.countRecentActions(input.adminId),
      this.repository.listRecentActions(input.adminId, input.query.page, input.query.pageSize),
      this.repository.listSessions(input.adminId),
      this.repository.countActiveSessions(input.adminId),
      this.repository.hasRecentPendingNewDeviceEvent(input.adminId),
      this.repository.listPendingSecurityEvents(input.adminId),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / input.query.pageSize));

    return {
      identity: {
        fullName: identity.full_name ?? identity.email ?? "Admin",
        email: identity.email,
        role: identity.role,
        adminCode: identity.admin_code,
        joinedAt: identity.joined_at,
        lastLoginAt: identity.last_login_at,
        lastLoginIp: identity.last_login_ip,
        lastLoginUserAgent: identity.last_login_user_agent,
      },
      permissions: buildPermissions(identity.role),
      stats: {
        approvals: toNumber(stats.approvals),
        rejects: toNumber(stats.rejects),
        avgReviewMinutes: toNumber(stats.avg_review_minutes),
        actions7d: toNumber(stats.actions_7d),
      },
      recentActions: actions.map((row) => ({
        id: row.id,
        action: row.action,
        studentId: row.student_id,
        submissionId: row.submission_id,
        submissionTitle: row.submission_title,
        createdAt: row.created_at,
      })),
      pagination: {
        page: input.query.page,
        pageSize: input.query.pageSize,
        total,
        totalPages,
        hasPrev: input.query.page > 1,
        hasNext: input.query.page < totalPages,
      },
      security: {
        currentSessionActive: true,
        activeSessionsCount,
        logoutOtherSessionsRestricted: restricted && identity.role !== "superadmin",
        restrictionReason:
          restricted && identity.role !== "superadmin"
            ? "For security reasons, logout of other devices is temporarily restricted."
            : null,
        pendingSecurityEvents: pendingEvents.map((event) => ({
          id: event.id,
          type: event.type,
          status: event.status,
          createdAt: event.created_at,
        })),
        sessions: sessions.map((session) => ({
          id: session.id,
          isCurrent: session.session_token === sessionToken,
          deviceName: this.deviceNameFromUserAgent(session.user_agent),
          ip: session.ip,
          lastSeenAt: session.last_seen_at,
          createdAt: session.created_at,
          isRevoked: Boolean(session.revoked_at),
        })),
      },
    };
  }

  async logoutCurrentSession(input: {
    adminId: string;
    sessionToken: string;
    requestIp: string;
    userAgent: string | null;
  }): Promise<void> {
    await this.repository.revokeCurrentSession(input.adminId, input.sessionToken.trim());
    await this.audit.insert({
      actorUserId: input.adminId,
      entityTable: "admin_sessions",
      entityId: input.sessionToken.trim(),
      action: "logout_current_session",
      requestIp: readClientIp(input.requestIp),
      userAgent: input.userAgent,
      metadata: { scope: "current" },
    });
  }

  async logoutOtherSessions(input: {
    adminId: string;
    role: "admin" | "superadmin";
    sessionToken: string;
    requestIp: string;
    userAgent: string | null;
  }): Promise<{ revokedCount: number; restricted: boolean }> {
    const restricted = input.role !== "superadmin" && (await this.repository.hasRecentPendingNewDeviceEvent(input.adminId));
    if (restricted) {
      await this.repository.createSecurityEvent({
        adminId: input.adminId,
        type: "logout_others_request",
        metadata: {
          reason: "new_device_restriction",
          requestIp: readClientIp(input.requestIp),
          userAgent: input.userAgent,
          requestedAt: new Date().toISOString(),
        },
      });
      this.notifications.notifySuperadminsSecurityAlert(
        `Security alert: restricted "logout other sessions" requested by admin ${input.adminId}.`,
      );
      return { revokedCount: 0, restricted: true };
    }

    const revokedCount = await this.repository.revokeOtherSessions(input.adminId, input.sessionToken.trim());
    await this.audit.insert({
      actorUserId: input.adminId,
      entityTable: "admin_sessions",
      entityId: input.sessionToken.trim(),
      action: "logout_other_sessions",
      requestIp: readClientIp(input.requestIp),
      userAgent: input.userAgent,
      metadata: { scope: "others", revokedCount },
    });
    return { revokedCount, restricted: false };
  }

  async approveSecurityEvent(input: { eventId: string; approvedByAdminId: string }): Promise<void> {
    const updated = await this.repository.approveSecurityEvent(input.eventId, input.approvedByAdminId);
    if (!updated) {
      throw new ServiceError(404, "Pending security event not found");
    }
  }

  async recordAdminPanelLogin(input: {
    adminId: string;
    sessionToken: string;
    requestIp: string;
    userAgent: string | null;
  }): Promise<void> {
    await this.ensureSession({
      adminId: input.adminId,
      sessionToken: input.sessionToken.trim(),
      ip: readClientIp(input.requestIp),
      userAgent: input.userAgent,
      displayName: input.adminId,
    });
    await this.audit.insert({
      actorUserId: input.adminId,
      entityTable: "auth",
      entityId: input.adminId,
      action: "login",
      requestIp: readClientIp(input.requestIp),
      userAgent: input.userAgent,
      metadata: { source: "admin_panel" },
    });
  }

  private async ensureSession(input: {
    adminId: string;
    sessionToken: string;
    ip: string | null;
    userAgent: string | null;
    displayName: string;
  }): Promise<void> {
    const existing = await this.repository.findSession(input.adminId, input.sessionToken);
    if (existing && !existing.revoked_at) {
      await this.repository.touchSession(input.adminId, input.sessionToken, input.ip, input.userAgent);
      return;
    }

    const fingerprint = fingerprintFromSignals(input.userAgent, input.ip);
    const hadAnySession = await this.repository.hasAnySessionHistory(input.adminId);
    const knownFingerprint = await this.repository.hasKnownFingerprint(input.adminId, fingerprint);
    await this.repository.createSession({
      adminId: input.adminId,
      sessionToken: input.sessionToken,
      fingerprint,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    if (!hadAnySession) {
      await this.repository.createSecurityEvent({
        adminId: input.adminId,
        type: "admin_registration",
        metadata: {
          sessionToken: input.sessionToken,
          ip: input.ip,
          userAgent: input.userAgent,
          createdAt: new Date().toISOString(),
        },
      });
      this.notifications.notifySuperadminsSecurityAlert(
        `Security alert: new admin registration/login detected for ${input.displayName} (${input.adminId}).`,
      );
    }

    if (!knownFingerprint) {
      await this.repository.createSecurityEvent({
        adminId: input.adminId,
        type: "new_device_login",
        metadata: {
          sessionToken: input.sessionToken,
          ip: input.ip,
          userAgent: input.userAgent,
          createdAt: new Date().toISOString(),
        },
      });
      this.notifications.notifySuperadminsSecurityAlert(
        `Security alert: new admin device login detected for ${input.displayName} (${input.adminId}).`,
      );
    }
  }

  private deviceNameFromUserAgent(userAgent: string | null): string {
    const text = userAgent?.trim();
    if (!text) {
      return "Unknown Device";
    }
    if (text.includes("Mac OS")) {
      return "Mac Device";
    }
    if (text.includes("Windows")) {
      return "Windows Device";
    }
    if (text.includes("Android")) {
      return "Android Device";
    }
    if (text.includes("iPhone") || text.includes("iPad")) {
      return "iOS Device";
    }
    return "Browser Session";
  }
}
