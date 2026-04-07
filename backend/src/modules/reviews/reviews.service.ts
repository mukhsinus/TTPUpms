import type {
  ReviewsRepository,
  ReviewSubmissionEntity,
  ReviewSubmissionItemEntity,
} from "./reviews.repository";
import type { CompleteSubmissionReviewBody, ReviewItemBody } from "./reviews.schema";
import type { NotificationService } from "../notifications/notification.service";

type Role = "student" | "reviewer" | "admin";
type SubmissionStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "needs_revision";

export interface AuthUser {
  id: string;
  role: Role;
}

class ServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "ServiceError";
  }
}

const REVIEWABLE_STATUSES = new Set<SubmissionStatus>(["submitted", "under_review", "needs_revision"]);

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

    if (!REVIEWABLE_STATUSES.has(submission.status)) {
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

    if (!REVIEWABLE_STATUSES.has(submission.status)) {
      throw new ServiceError(
        409,
        `Submission in status "${submission.status}" cannot be reviewed`,
      );
    }

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

    const updated = await this.repository.updateSubmissionStatus(submissionId, body.decision);

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

export { ServiceError as ReviewsServiceError };
