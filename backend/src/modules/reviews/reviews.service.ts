import type {
  ReviewsRepository,
  ReviewSubmissionEntity,
  ReviewSubmissionItemEntity,
} from "./reviews.repository";
import type { CompleteSubmissionReviewBody, ReviewItemBody } from "./reviews.schema";
import type { NotificationService } from "../notifications/notification.service";
import type { ScoringService } from "../scoring/scoring.service";
import {
  assertValidTransition,
  REVIEW_ACTIVE_STATUSES,
} from "../submissions/submission-transitions";
import { ServiceError } from "../../utils/service-error";

type Role = "student" | "reviewer" | "admin";

export interface AuthUser {
  id: string;
  role: Role;
}

export class ReviewsService {
  constructor(
    private readonly repository: ReviewsRepository,
    private readonly notifications: NotificationService,
    private readonly scoring: ScoringService,
  ) {}

  async getReviewableSubmissions(user: AuthUser): Promise<ReviewSubmissionEntity[]> {
    if (user.role === "admin") {
      return this.repository.findAllSubmissions();
    }

    if (user.role === "reviewer") {
      return this.repository.findSubmissionsAwaitingReview();
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

    await this.assertValidItemScore(item, body.score);

    let reviewed: ReviewSubmissionItemEntity;
    if (submission.status === "submitted") {
      assertValidTransition("submitted", "under_review");
      reviewed = await this.repository.reviewItemPromotingFromSubmitted({
        submissionId,
        itemId,
        reviewerId: user.id,
        score: body.score,
        comment: body.comment,
        decision: body.decision,
      });
    } else {
      reviewed = await this.repository.reviewItem({
        itemId,
        reviewerId: user.id,
        score: body.score,
        comment: body.comment,
        decision: body.decision,
      });
    }

    await this.scoring.syncSubmissionTotalPoints(submissionId);
    return reviewed;
  }

  async startSubmissionReview(user: AuthUser, submissionId: string): Promise<ReviewSubmissionEntity> {
    await this.assertReviewerAccess(user, submissionId);
    const submission = await this.repository.findSubmissionById(submissionId);
    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }
    assertValidTransition(submission.status, "under_review");
    return this.repository.startSubmissionReview(submissionId);
  }

  async completeSubmissionReview(
    user: AuthUser,
    submissionId: string,
    body: CompleteSubmissionReviewBody,
  ): Promise<ReviewSubmissionEntity> {
    const submission = await this.assertReviewerAccess(user, submissionId);

    if (submission.status !== "under_review") {
      throw new ServiceError(
        409,
        "Submission review can only be completed while status is under_review",
      );
    }

    assertValidTransition(submission.status, body.decision);

    const items = await this.repository.findSubmissionItems(submissionId);
    if (items.length === 0) {
      throw new ServiceError(409, "Submission has no items to review");
    }

    const unreviewedCount = await this.repository.countUnreviewedItems(submissionId);
    if (unreviewedCount > 0) {
      throw new ServiceError(
        409,
        "Each submission item must be reviewed before the submission can be finalized",
      );
    }

    const scoringResult = await this.scoring.syncSubmissionTotalPoints(submissionId);

    await this.repository.upsertSubmissionReview({
      submissionId,
      reviewerId: user.id,
      score: scoringResult.totalScore,
      decision: body.decision,
      comment: body.comment,
    });

    const updated = await this.repository.setSubmissionWorkflowStatus(
      submissionId,
      body.decision,
      true,
    );

    if (body.decision === "approved" || body.decision === "rejected" || body.decision === "needs_revision") {
      this.notifications.notifySubmissionStatusChanged({
        userId: submission.userId,
        submissionId,
        status: body.decision,
      });
    }

    return updated;
  }

  private async assertValidItemScore(item: ReviewSubmissionItemEntity, score: number): Promise<void> {
    if (score > item.proposedScore) {
      throw new ServiceError(
        400,
        `Score cannot exceed the proposed maximum (${item.proposedScore})`,
      );
    }

    const bounds = await this.repository.findCategoryBoundsForItem(item.id);
    if (!bounds) {
      return;
    }

    if (score < bounds.minScore || score > bounds.maxScore) {
      throw new ServiceError(
        400,
        `Score must be within the category range ${bounds.minScore}–${bounds.maxScore}`,
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
      return submission;
    }

    throw new ServiceError(403, "Forbidden");
  }
}

export { ServiceError as ReviewsServiceError } from "../../utils/service-error";
