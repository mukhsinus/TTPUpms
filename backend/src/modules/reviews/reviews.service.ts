import type { FastifyBaseLogger } from "fastify";
import type {
  ReviewsRepository,
  ReviewSubmissionEntity,
  ReviewSubmissionItemEntity,
} from "./reviews.repository";
import type { CompleteSubmissionReviewBody, ReviewItemBody } from "./reviews.schema";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import type { ScoringRulesRepository } from "../scoring/scoring-rules.repository";
import { resolveFixedPointsFromRules } from "../scoring/scoring-metadata";
import {
  assertValidTransition,
  REVIEW_ACTIVE_STATUSES,
} from "../submissions/submission-transitions";
import { ServiceError } from "../../utils/service-error";
import type { AuthUser } from "../../types/auth-user";

export class ReviewsService {
  constructor(
    private readonly repository: ReviewsRepository,
    private readonly notifications: NotificationService,
    private readonly audit: AuditLogRepository,
    private readonly scoringRules: ScoringRulesRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  async getReviewableSubmissions(user: AuthUser): Promise<ReviewSubmissionEntity[]> {
    if (user.role === "admin") {
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

    const scoringKind: "fixed" | "range" | "expert" =
      item.categoryType === "manual" ? "expert" : (item.categoryType as "fixed" | "range" | "expert");
    let finalScore = body.score;
    let scoringSource: "rules" | "proposed" | "reviewer" | null = null;

    if (scoringKind === "fixed") {
      const rules = item.subcategoryId
        ? await this.scoringRules.findRulesBySubcategoryId(item.subcategoryId)
        : [];
      const resolved = resolveFixedPointsFromRules(item.metadata, rules);
      if (resolved !== null) {
        if (finalScore !== undefined && finalScore !== resolved) {
          throw new ServiceError(
            400,
            `Score for fixed categories must equal ${resolved} (rule-based)`,
            "VALIDATION_ERROR",
          );
        }
        finalScore = resolved;
        scoringSource = "rules";
      } else if (finalScore !== undefined && Number.isFinite(finalScore)) {
        scoringSource = "reviewer";
      } else if (item.proposedScore !== null && Number.isFinite(item.proposedScore)) {
        finalScore = item.proposedScore;
        scoringSource = "proposed";
      } else {
        throw new ServiceError(
          400,
          "score is required when no automatic rule applies for this item.",
          "VALIDATION_ERROR",
        );
      }
    } else {
      if (finalScore === undefined || !Number.isFinite(finalScore)) {
        throw new ServiceError(
          400,
          "score is required for range and expert categories",
          "VALIDATION_ERROR",
        );
      }
      scoringSource = "reviewer";
    }

    await this.assertValidItemScore(item, finalScore, scoringKind);

    if (submission.status === "submitted") {
      assertValidTransition("submitted", "review");
    }

    this.log.info({
      event: "scoring_applied",
      submissionId,
      itemId,
      score: finalScore,
      scoringKind,
      source: scoringSource,
    });

    return this.repository.reviewSubmissionItemLocked({
      submissionId,
      itemId,
      reviewerId: user.id,
      score: finalScore,
      comment: body.comment,
      decision: body.decision,
    });
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

    if (body.decision === "approved" || body.decision === "rejected" || body.decision === "needs_revision") {
      this.notifications.notifySubmissionStatusChanged({
        userId: submission.userId,
        submissionId,
        status: body.decision,
      });
    }

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
    scoringKind: "fixed" | "range" | "expert",
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

    if (
      scoringKind !== "fixed" &&
      item.proposedScore !== null &&
      Number.isFinite(item.proposedScore) &&
      score > item.proposedScore
    ) {
      throw new ServiceError(
        400,
        `Score cannot exceed the proposed maximum (${item.proposedScore})`,
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

    if (user.role === "admin") {
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
}

export { ServiceError as ReviewsServiceError } from "../../utils/service-error";
