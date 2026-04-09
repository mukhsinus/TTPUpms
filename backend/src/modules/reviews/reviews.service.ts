import type {
  ReviewsRepository,
  ReviewSubmissionEntity,
  ReviewSubmissionItemEntity,
} from "./reviews.repository";
import type { CompleteSubmissionReviewBody, ReviewItemBody } from "./reviews.schema";
import type { NotificationService } from "../notifications/notification.service";
import { assertValidTransition } from "../submissions/submission-transitions";
import { ServiceError } from "../../utils/service-error";

type Role = "student" | "reviewer" | "admin";
type SubmissionStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "needs_revision";

export interface AuthUser {
  id: string;
  role: Role;
}

/** Item-level review: owner must have submitted; under_review continues in-progress review. */
const ITEM_REVIEW_STATUSES = new Set<SubmissionStatus>(["submitted", "under_review"]);

export class ReviewsService {
  constructor(
    private readonly repository: ReviewsRepository,
    private readonly notifications: NotificationService,
  ) {}

  async getReviewableSubmissions(user: AuthUser): Promise<ReviewSubmissionEntity[]> {
    if (user.role === "admin") {
      return this.repository.findAllSubmissions();
    }

    return this.repository.findAssignedSubmissions(user.id);
  }

  async getSubmissionItemsForReview(
    user: AuthUser,
    submissionId: string,
  ): Promise<ReviewSubmissionItemEntity[]> {
    await this.assertReviewerAccess(user, submissionId);
    return this.repository.findSubmissionItems(submissionId);
  }

  async reviewSubmissionItem(
    user: AuthUser,
    submissionId: string,
    itemId: string,
    body: ReviewItemBody,
  ): Promise<ReviewSubmissionItemEntity> {
    const submission = await this.assertReviewerAccess(user, submissionId);

    if (!ITEM_REVIEW_STATUSES.has(submission.status)) {
      throw new ServiceError(
        409,
        `Submission in status "${submission.status}" cannot be reviewed`,
      );
    }

    const item = await this.repository.findSubmissionItemById(itemId);
    if (!item || item.submissionId !== submissionId) {
      throw new ServiceError(404, "Submission item not found");
    }

    if (body.score > item.proposedScore) {
      throw new ServiceError(
        400,
        `Score cannot exceed max proposed score (${item.proposedScore})`,
      );
    }

    if (submission.status === "submitted") {
      assertValidTransition("submitted", "under_review");
      return this.repository.reviewItemPromotingFromSubmitted({
        submissionId,
        itemId,
        reviewerId: user.id,
        score: body.score,
        comment: body.comment,
        decision: body.decision,
      });
    }

    return this.repository.reviewItem({
      itemId,
      reviewerId: user.id,
      score: body.score,
      comment: body.comment,
      decision: body.decision,
    });
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
    if (body.decision === "approved" && unreviewedCount > 0) {
      throw new ServiceError(
        409,
        "Each submission item must be reviewed before submission approval",
      );
    }

    const totalAssignedScore = items.reduce((sum, item) => sum + (item.reviewerScore ?? 0), 0);

    await this.repository.upsertSubmissionReview({
      submissionId,
      reviewerId: user.id,
      score: totalAssignedScore,
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

    const assigned = await this.repository.isReviewerAssigned(submissionId, user.id);
    if (!assigned) {
      throw new ServiceError(403, "Reviewer is not assigned to this submission");
    }

    return submission;
  }
}

export { ServiceError as ReviewsServiceError } from "../../utils/service-error";
