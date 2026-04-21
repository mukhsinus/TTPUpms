import type { AdminOverrideRepository, AdminSubmissionEntity } from "./admin-override.repository";
import type { OverrideScoreBody, OverrideStatusBody } from "./admin-override.schema";
import type { NotificationService } from "../notifications/notification.service";
import { assertValidTransition } from "../submissions/submission-transitions";
import type { SubmissionStatus } from "../submissions/submissions.schema";
import { ServiceError } from "../../utils/service-error";

interface ActorContext {
  actorUserId: string;
  requestIp?: string;
  userAgent?: string;
}

export class AdminOverrideService {
  constructor(
    private readonly repository: AdminOverrideRepository,
    private readonly notifications: NotificationService,
  ) {}

  async overrideSubmissionScore(
    submissionId: string,
    body: OverrideScoreBody,
    actor: ActorContext,
  ): Promise<AdminSubmissionEntity> {
    const submission = await this.repository.findSubmissionById(submissionId);
    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (submission.totalPoints === body.totalScore) {
      throw new ServiceError(409, "Submission score is already set to this value");
    }

    const updated = await this.repository.updateSubmissionScore(submissionId, body.totalScore);

    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: submission.userId,
      entityTable: "submissions",
      entityId: submissionId,
      action: "moderation_submission_score_overridden",
      oldValues: {
        totalPoints: submission.totalPoints,
      },
      newValues: {
        totalPoints: updated.totalPoints,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: submission.userId,
      entityTable: "submissions",
      entityId: submissionId,
      action: "admin_override_score",
      oldValues: {
        totalPoints: submission.totalPoints,
      },
      newValues: {
        totalPoints: updated.totalPoints,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });

    return updated;
  }

  async overrideSubmissionStatus(
    submissionId: string,
    body: OverrideStatusBody,
    actor: ActorContext,
  ): Promise<AdminSubmissionEntity> {
    const submission = await this.repository.findSubmissionById(submissionId);
    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (submission.status === body.status) {
      throw new ServiceError(409, "Submission status is already set to this value");
    }

    assertValidTransition(submission.status as SubmissionStatus, body.status);

    const updated = await this.repository.updateSubmissionStatus(submissionId, body.status);

    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: submission.userId,
      entityTable: "submissions",
      entityId: submissionId,
      action: "moderation_submission_status_overridden",
      oldValues: {
        status: submission.status,
      },
      newValues: {
        status: updated.status,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: submission.userId,
      entityTable: "submissions",
      entityId: submissionId,
      action: "admin_override_status",
      oldValues: {
        status: submission.status,
      },
      newValues: {
        status: updated.status,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });

    if (body.status === "approved" || body.status === "rejected") {
      this.notifications.notifySubmissionStatusChanged({
        userId: submission.userId,
        submissionId,
        status: body.status,
      });
    }

    return updated;
  }
}

export { ServiceError as AdminOverrideServiceError } from "../../utils/service-error";
