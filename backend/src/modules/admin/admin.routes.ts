import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import {
  requireActiveAdminForSensitiveAction,
  requireAdmin,
  requireSuperadmin,
} from "../../middleware/admin.middleware";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { SystemPhaseService } from "../system/system-phase.service";
import { AdminOverrideController } from "./admin-override.controller";
import { AdminOverrideRepository } from "./admin-override.repository";
import { AdminOverrideService } from "./admin-override.service";
import { AdminProfileController } from "./admin-profile.controller";
import { AdminProfileService } from "./admin-profile.service";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";
import { SuperadminController } from "./superadmin.controller";
import { SuperadminService } from "./superadmin.service";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const notifications = new NotificationService(app);
  const audit = new AuditLogRepository(app);

  const moderationRepository = new AdminRepository(app);
  const phaseService = new SystemPhaseService(app);
  const moderationService = new AdminService(app, moderationRepository, audit, notifications, phaseService);
  const moderationController = new AdminController(moderationService);
  const profileService = new AdminProfileService(app, notifications, audit);
  const profileController = new AdminProfileController(profileService);

  const overrideRepository = new AdminOverrideRepository(app);
  const overrideService = new AdminOverrideService(overrideRepository, notifications);
  const overrideController = new AdminOverrideController(overrideService);
  const superadminService = new SuperadminService(app, audit, notifications);
  const superadminController = new SuperadminController(superadminService);

  await app.register(async (r) => {
    r.addHook("preHandler", authMiddleware);
    r.addHook("preHandler", requireAdmin);

    r.get(
      "/metrics",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getMetrics,
    );

    r.get(
      "/dashboard",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getDashboard,
    );

    r.get(
      "/dashboard/admins/:adminId",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getAdminActivityProfile,
    );

    r.get(
      "/profile",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      profileController.getProfile,
    );

    r.patch(
      "/profile",
      {
        preHandler: [requireActiveAdminForSensitiveAction],
        config: { rateLimit: { max: 40, timeWindow: "1 minute" } },
      },
      profileController.updateIdentity,
    );

    r.post(
      "/profile/logout-current",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      profileController.logoutCurrentSession,
    );

    r.post(
      "/profile/logout-others",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      profileController.logoutOtherSessions,
    );

    r.post(
      "/profile/security-events/:eventId/approve",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      profileController.approveSecurityEvent,
    );

    r.get(
      "/submissions",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.listSubmissions,
    );

    r.get(
      "/submissions/groups",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.listSubmissionGroups,
    );

    r.get(
      "/submissions/groups/:groupKey",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getSubmissionGroupDetail,
    );

    r.get(
      "/submissions/search-suggestions",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.listSearchSuggestions,
    );

    r.get(
      "/submissions/student-overview",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getStudentOverview,
    );

    r.get(
      "/students",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.listStudents,
    );

    r.get(
      "/students/:id",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getStudentById,
    );

    r.patch(
      "/students/:id",
      {
        preHandler: [requireActiveAdminForSensitiveAction],
        config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
      },
      moderationController.updateStudentById,
    );

    r.get(
      "/submissions/:id",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getSubmission,
    );

    r.post(
      "/submissions/:id/approve",
      { config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
      moderationController.approveSubmission,
    );

    r.post(
      "/submissions/:id/reject",
      { config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
      moderationController.rejectSubmission,
    );

    r.patch(
      "/submissions/:submissionId/override-score",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
      },
      overrideController.overrideScore,
    );

    r.patch(
      "/submissions/:submissionId/override-status",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
      },
      overrideController.overrideStatus,
    );

    r.get(
      "/super/dashboard",
      {
        preHandler: [requireSuperadmin],
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      superadminController.getDashboard,
    );

    r.get(
      "/admins",
      {
        preHandler: [requireSuperadmin],
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      superadminController.listAdmins,
    );

    r.get(
      "/admins/:adminId",
      {
        preHandler: [requireSuperadmin],
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      superadminController.getAdminDetail,
    );

    r.patch(
      "/admins/:adminId/role",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      },
      superadminController.changeAdminRole,
    );

    r.patch(
      "/admins/:adminId/status",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      },
      superadminController.changeAdminStatus,
    );

    r.post(
      "/admins/:adminId/reset-password",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      },
      superadminController.resetAdminPassword,
    );

    r.get(
      "/audit",
      {
        preHandler: [requireSuperadmin],
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      superadminController.listAuditLogs,
    );

    r.get(
      "/security/events",
      {
        preHandler: [requireSuperadmin],
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      superadminController.listSecurityEvents,
    );

    r.post(
      "/security/events/:eventId/resolve",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 40, timeWindow: "1 minute" } },
      },
      superadminController.resolveSecurityEvent,
    );

    r.post(
      "/security/admins/:adminId/revoke-sessions",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      },
      superadminController.revokeAdminSessions,
    );

    r.post(
      "/submissions/:submissionId/assign",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
      },
      superadminController.assignSubmission,
    );

    r.get(
      "/submissions/:submissionId/notes",
      {
        preHandler: [requireSuperadmin],
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      superadminController.listSubmissionNotes,
    );

    r.post(
      "/submissions/:submissionId/notes",
      {
        preHandler: [requireActiveAdminForSensitiveAction, requireSuperadmin],
        config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
      },
      superadminController.addSubmissionNote,
    );

    r.get(
      "/reports/activity.pdf",
      {
        preHandler: [requireSuperadmin],
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      },
      superadminController.exportActivityPdf,
    );
  });
}
