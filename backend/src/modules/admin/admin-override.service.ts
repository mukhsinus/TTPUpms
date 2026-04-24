import type {
  AdminOverrideRepository,
  AdminSubmissionEntity,
  AdminSubmissionItemEntity,
} from "./admin-override.repository";
import type {
  OverrideItemScoreBody,
  OverrideItemStatusBody,
  OverrideScoreBody,
  OverrideStatusBody,
} from "./admin-override.schema";
import type { NotificationService } from "../notifications/notification.service";
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
    if (body.status === "draft") {
      throw new ServiceError(409, 'Force status to "draft" is not allowed');
    }
    if (submission.status === "draft") {
      throw new ServiceError(409, "Draft submissions must be submitted first");
    }

    const updated = await this.repository.updateSubmissionStatus(submissionId, body.status);
    await this.repository.overrideSubmissionItemsStatus(submissionId, body.status, actor.actorUserId);

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

  async overrideSubmissionItemStatus(
    itemId: string,
    body: OverrideItemStatusBody,
    actor: ActorContext,
  ): Promise<AdminSubmissionItemEntity> {
    const item = await this.repository.findSubmissionItemById(itemId);
    if (!item) {
      throw new ServiceError(404, "Submission item not found");
    }
    if (
      item.status === body.status &&
      (body.status === "rejected" || body.approvedScore === undefined || item.approvedScore === body.approvedScore)
    ) {
      throw new ServiceError(409, "Submission item is already set to this value");
    }

    const updated = await this.repository.overrideSubmissionItemStatus(itemId, {
      status: body.status,
      approvedScore: body.approvedScore,
      reviewedByUserId: actor.actorUserId,
    });

    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: item.submissionUserId,
      entityTable: "submission_items",
      entityId: itemId,
      action: body.status === "approved" ? "moderation_item_approved" : "moderation_item_rejected",
      oldValues: {
        status: item.status,
        approvedScore: item.approvedScore,
      },
      newValues: {
        status: updated.status,
        approvedScore: updated.approvedScore,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: item.submissionUserId,
      entityTable: "submission_items",
      entityId: itemId,
      action: "admin_override_status",
      oldValues: {
        status: item.status,
        approvedScore: item.approvedScore,
      },
      newValues: {
        status: updated.status,
        approvedScore: updated.approvedScore,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });

    await this.repository.syncSubmissionStatusFromItems(updated.submissionId, actor.actorUserId);

    return updated;
  }

  async overrideSubmissionItemScore(
    itemId: string,
    body: OverrideItemScoreBody,
    actor: ActorContext,
  ): Promise<AdminSubmissionItemEntity> {
    const item = await this.repository.findSubmissionItemById(itemId);
    if (!item) {
      throw new ServiceError(404, "Submission item not found");
    }
    if (item.status === "approved" && item.approvedScore === body.approvedScore) {
      throw new ServiceError(409, "Submission item score is already set to this value");
    }

    const updated = await this.repository.overrideSubmissionItemScore(
      itemId,
      body.approvedScore,
      actor.actorUserId,
    );

    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: item.submissionUserId,
      entityTable: "submission_items",
      entityId: itemId,
      action: "moderation_item_score_changed",
      oldValues: {
        status: item.status,
        approvedScore: item.approvedScore,
      },
      newValues: {
        status: updated.status,
        approvedScore: updated.approvedScore,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
    await this.repository.insertAuditLog({
      actorUserId: actor.actorUserId,
      targetUserId: item.submissionUserId,
      entityTable: "submission_items",
      entityId: itemId,
      action: "admin_override_score",
      oldValues: {
        status: item.status,
        approvedScore: item.approvedScore,
      },
      newValues: {
        status: updated.status,
        approvedScore: updated.approvedScore,
        reason: body.reason ?? null,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });

    await this.repository.syncSubmissionStatusFromItems(updated.submissionId, actor.actorUserId);

    return updated;
  }
}

export { ServiceError as AdminOverrideServiceError } from "../../utils/service-error";
