import { ServiceError } from "../../utils/service-error";
import type { NotificationService } from "../notifications/notification.service";
import type { AntiFraudService } from "../validation/anti-fraud.service";
import { assertValidTransition } from "./submission-transitions";
import type { SubmissionsRepository, SubmissionEntity } from "./submissions.repository";
import type { CreateSubmissionBody } from "./submissions.schema";

type Role = "student" | "reviewer" | "admin";

export interface AuthUser {
  id: string;
  role: Role;
}

export class SubmissionsService {
  constructor(
    private readonly repository: SubmissionsRepository,
    private readonly notifications: NotificationService,
    private readonly antiFraud: AntiFraudService,
  ) {}

  async createSubmission(user: AuthUser, input: CreateSubmissionBody): Promise<SubmissionEntity> {
    const targetUserId = user.role === "admin" && input.userId ? input.userId : user.id;

    if (user.role !== "admin" && input.userId && input.userId !== user.id) {
      throw new ServiceError(403, "You cannot create submissions for another user");
    }

    await this.antiFraud.assertNoDuplicateSubmission({
      userId: targetUserId,
      title: input.title,
      description: input.description,
    });

    return this.repository.create({
      userId: targetUserId,
      title: input.title,
      description: input.description,
    });
  }

  async getUserSubmissions(user: AuthUser, requestedUserId?: string): Promise<SubmissionEntity[]> {
    if (user.role === "admin") {
      if (requestedUserId) {
        return this.repository.findByUserId(requestedUserId);
      }

      return this.repository.findAll();
    }

    if (user.role === "reviewer") {
      return this.repository.findAssignedToReviewer(user.id);
    }

    return this.repository.findByUserId(user.id);
  }

  async getSubmissionById(user: AuthUser, submissionId: string): Promise<SubmissionEntity> {
    const submission = await this.requireSubmission(submissionId);
    await this.assertReadAccess(user, submission);
    return submission;
  }

  async submitSubmission(user: AuthUser, submissionId: string): Promise<SubmissionEntity> {
    const submission = await this.requireSubmission(submissionId);

    if (submission.userId !== user.id) {
      throw new ServiceError(403, "Only the submission owner can submit");
    }

    assertValidTransition(submission.status, "submitted");

    const updated = await this.repository.updateStatus({
      id: submission.id,
      status: "submitted",
      submittedAt: true,
    });

    this.notifications.notifySubmissionSubmitted({
      userId: updated.userId,
      submissionId: updated.id,
      title: updated.title,
    });

    return updated;
  }

  private async requireSubmission(submissionId: string): Promise<SubmissionEntity> {
    const submission = await this.repository.findById(submissionId);

    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    return submission;
  }

  private async assertReadAccess(user: AuthUser, submission: SubmissionEntity): Promise<void> {
    if (user.role === "admin") {
      return;
    }

    if (user.role === "student") {
      if (submission.userId !== user.id) {
        throw new ServiceError(403, "You can only access your own submissions");
      }
      return;
    }

    const assigned = await this.repository.findReviewerAssignedById(submission.id, user.id);
    if (!assigned) {
      throw new ServiceError(403, "You can only access assigned submissions");
    }
  }
}
