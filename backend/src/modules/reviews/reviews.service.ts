import type { FastifyBaseLogger } from "fastify";
import type {
  ReviewsRepository,
  ReviewSubmissionEntity,
  ReviewSubmissionItemEntity,
} from "./reviews.repository";
import type { CompleteSubmissionReviewBody, ReviewItemBody } from "./reviews.schema";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import {
  assertValidTransition,
  REVIEW_ACTIVE_STATUSES,
} from "../submissions/submission-transitions";
import { ServiceError } from "../../utils/service-error";
import type { AuthUser } from "../../types/auth-user";
import { isAdminPanelOperator } from "../../utils/admin-roles";

export class ReviewsService {
  constructor(
    private readonly repository: ReviewsRepository,
    private readonly notifications: NotificationService,
    private readonly audit: AuditLogRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  async getReviewableSubmissions(user: AuthUser): Promise<ReviewSubmissionEntity[]> {
    if (isAdminPanelOperator(user.role)) {
      return this.repository.findAllSubmissions();
    }

    if (user.role === "reviewer") {
      return this.repository.findSubmissionsAwaitingReviewForReviewer(user.id);
    }

    throw new ServiceError(403, "Forbidden");
  }

  async getSubmissionItemsForReview(
    user: AuthUser,
    submissionId: string,
  ): Promise<ReviewSubmissionItemEntity[]> {
    await this.assertReviewerAccess(user, submissionId);
    return this.repository.findSubmissionItems(submissionId);
  }

  async patchSubmissionItem(
    user: AuthUser,
    itemId: string,
    body: ReviewItemBody,
  ): Promise<ReviewSubmissionItemEntity> {
    const submissionId = await this.repository.findSubmissionIdForItem(itemId);
    if (!submissionId) {
      throw new ServiceError(404, "Submission item not found");
    }

    return this.reviewSubmissionItem(user, submissionId, itemId, body);
  }

  async reviewSubmissionItem(
    user: AuthUser,
    submissionId: string,
    itemId: string,
    body: ReviewItemBody,
  ): Promise<ReviewSubmissionItemEntity> {
    const submission = await this.assertReviewerAccess(user, submissionId);

    if (!REVIEW_ACTIVE_STATUSES.has(submission.status)) {
      throw new ServiceError(
        409,
        `Submission in status "${submission.status}" cannot be reviewed`,
      );
    }

    const item = await this.repository.findSubmissionItemById(itemId);
    if (!item || item.submissionId !== submissionId) {
      throw new ServiceError(404, "Submission item not found");
    }

    const finalScore = body.score;
    if (finalScore === undefined || !Number.isFinite(finalScore)) {
      throw new ServiceError(
        400,
        "score is required for item moderation",
        "VALIDATION_ERROR",
      );
    }

    await this.assertValidItemScore(item, finalScore);

    if (submission.status === "submitted") {
      assertValidTransition("submitted", "review");
    }

    this.log.info({
      event: "scoring_applied",
      submissionId,
      itemId,
      score: finalScore,
      scoringKind: item.categoryType === "manual" ? "expert" : item.categoryType,
      source: "reviewer",
    });

    const reviewedItem = await this.repository.reviewSubmissionItemLocked({
      submissionId,
      itemId,
      reviewerId: user.id,
      score: finalScore,
      comment: body.comment,
      decision: body.decision,
    });

    await this.autoFinalizeSubmissionIfReady(user, submissionId);
    return reviewedItem;
  }

  async startSubmissionReview(user: AuthUser, submissionId: string): Promise<ReviewSubmissionEntity> {
    await this.assertReviewerAccess(user, submissionId);
    const submission = await this.repository.findSubmissionById(submissionId);
    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }
    assertValidTransition(submission.status, "review");
    return this.repository.startSubmissionReview(submissionId);
  }

  async completeSubmissionReview(
    user: AuthUser,
    submissionId: string,
    body: CompleteSubmissionReviewBody,
  ): Promise<ReviewSubmissionEntity> {
    const submission = await this.assertReviewerAccess(user, submissionId);

    if (submission.status !== "review") {
      throw new ServiceError(
        409,
        'Submission review can only be completed while status is "review"',
      );
    }

    assertValidTransition(submission.status, body.decision);

    const updated = await this.repository.completeSubmissionReviewLocked({
      submissionId,
      reviewerId: user.id,
      decision: body.decision,
      comment: body.comment,
    });

    await this.sendSubmissionItemsSummaryNotification({
      submissionId,
      userId: submission.userId,
      submissionTitle: submission.title,
      finalStatus: body.decision,
      overallScore: updated.totalPoints,
    });

    await this.audit.insert({
      actorUserId: user.id,
      targetUserId: submission.userId,
      entityTable: "submissions",
      entityId: submissionId,
      action: "review_completed",
      newValues: {
        decision: body.decision,
        totalPoints: updated.totalPoints,
        status: updated.status,
      },
    });

    return updated;
  }

  private async assertValidItemScore(
    item: ReviewSubmissionItemEntity,
    score: number,
  ): Promise<void> {
    if (!Number.isFinite(score)) {
      throw new ServiceError(400, "Score must be a finite number.", "VALIDATION_ERROR");
    }

    const bounds = await this.repository.findCategoryBoundsForItem(item.id);
    if (!bounds) {
      throw new ServiceError(
        400,
        "Cannot score this item: no category scoring bounds found (category_id or category name must match a configured category).",
        "VALIDATION_ERROR",
      );
    }

    if (score < bounds.minScore || score > bounds.maxScore) {
      throw new ServiceError(
        400,
        `Score must be within the category range ${bounds.minScore}–${bounds.maxScore}`,
        "VALIDATION_ERROR",
      );
    }

  }

  private async assertReviewerAccess(
    user: AuthUser,
    submissionId: string,
  ): Promise<ReviewSubmissionEntity> {
    const submission = await this.repository.findSubmissionById(submissionId);
    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (isAdminPanelOperator(user.role)) {
      return submission;
    }

    if (user.role === "reviewer") {
      if (submission.status === "draft") {
        throw new ServiceError(403, "Submission is not available for review");
      }
      const assigned = await this.repository.isReviewerAssigned(submissionId, user.id);
      if (!assigned) {
        throw new ServiceError(403, "You are not assigned to review this submission");
      }
      return submission;
    }

    throw new ServiceError(403, "Forbidden");
  }

  private async autoFinalizeSubmissionIfReady(user: AuthUser, submissionId: string): Promise<void> {
    const pendingItems = await this.repository.countUnreviewedItems(submissionId);
    if (pendingItems > 0) {
      return;
    }
    const current = await this.repository.findSubmissionById(submissionId);
    if (!current || current.status !== "review") {
      return;
    }
    const items = await this.repository.findSubmissionItems(submissionId);
    if (items.length === 0) {
      return;
    }
    const approvedCount = items.filter((item) => item.status === "approved").length;
    const rejectedCount = items.filter((item) => item.status === "rejected").length;
    const decision: "approved" | "rejected" | "needs_revision" =
      approvedCount === items.length ? "approved" : rejectedCount === items.length ? "rejected" : "needs_revision";

    try {
      const finalized = await this.repository.completeSubmissionReviewLocked({
        submissionId,
        reviewerId: user.id,
        decision,
      });

      await this.audit.insert({
        actorUserId: user.id,
        targetUserId: current.userId,
        entityTable: "submissions",
        entityId: submissionId,
        action: "review_completed",
        newValues: {
          decision,
          totalPoints: finalized.totalPoints,
          status: finalized.status,
          autoFinalized: true,
        },
      });

      await this.sendSubmissionItemsSummaryNotification({
        submissionId,
        userId: current.userId,
        submissionTitle: current.title,
        finalStatus: decision,
        overallScore: finalized.totalPoints,
      });
    } catch (error) {
      if (
        error instanceof ServiceError &&
        error.statusCode === 409 &&
        /can only be completed while status is "review"/i.test(error.message)
      ) {
        return;
      }
      this.log.error({ err: error, submissionId }, "Auto finalize after item review failed");
    }
  }

  private async sendSubmissionItemsSummaryNotification(input: {
    submissionId: string;
    userId: string;
    submissionTitle: string | null;
    finalStatus: "approved" | "rejected" | "needs_revision";
    overallScore: number;
  }): Promise<void> {
    const items = await this.repository.findSubmissionItems(input.submissionId);
    const processedItems: Array<{
      title: string;
      status: "approved" | "rejected";
      approvedScore: number | null;
      comment: string | null;
    }> = [];
    for (const item of items) {
      if (item.status !== "approved" && item.status !== "rejected") {
        continue;
      }
      processedItems.push({
        title: item.title,
        status: item.status,
        approvedScore: item.status === "approved" ? item.approvedScore : null,
        comment: item.reviewerComment,
      });
    }
    if (processedItems.length === 0) {
      return;
    }
    this.notifications.notifySubmissionItemsReviewedSummary({
      userId: input.userId,
      submissionId: input.submissionId,
      submissionTitle: input.submissionTitle,
      finalStatus: input.finalStatus,
      overallScore: input.overallScore,
      items: processedItems,
    });
  }
}

export { ServiceError as ReviewsServiceError } from "../../utils/service-error";
