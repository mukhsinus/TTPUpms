import { ServiceError } from "../../utils/service-error";
import type { AuthUser } from "../../types/auth-user";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import type { AntiFraudService } from "../validation/anti-fraud.service";
import { assertStudentMaySubmitFromStatus } from "./submission-transitions";
import { MAX_ACTIVE_SUBMISSIONS_PER_USER } from "./submission-quota";
import type { UsersRepository } from "../users/users.repository";
import type { SubmissionsRepository, SubmissionEntity } from "./submissions.repository";
import type { CreateSubmissionBody } from "./submissions.schema";
import { isAdminPanelOperator } from "../../utils/admin-roles";

export class SubmissionsService {
  constructor(
    private readonly repository: SubmissionsRepository,
    private readonly notifications: NotificationService,
    private readonly antiFraud: AntiFraudService,
    private readonly audit: AuditLogRepository,
    private readonly users: UsersRepository,
  ) {}

  async createSubmission(user: AuthUser, input: CreateSubmissionBody): Promise<SubmissionEntity> {
    const targetUserId = isAdminPanelOperator(user.role) && input.userId ? input.userId : user.id;

    if (!isAdminPanelOperator(user.role) && input.userId && input.userId !== user.id) {
      throw new ServiceError(403, "You cannot create submissions for another user");
    }

    await this.users.assertStudentProfileCompleteForSubmission(targetUserId);

    await this.assertActiveSubmissionQuota(targetUserId, user.role);

    await this.antiFraud.assertNoDuplicateSubmission({
      userId: targetUserId,
      title: input.title,
      description: input.description,
    });

    const created = await this.repository.create({
      userId: targetUserId,
      title: input.title,
      description: input.description,
    });

    await this.audit.insert({
      actorUserId: user.id,
      targetUserId: targetUserId,
      entityTable: "submissions",
      entityId: created.id,
      action: "submission_created",
      newValues: { title: created.title, status: created.status },
    });

    return created;
  }

  async getUserSubmissions(user: AuthUser, requestedUserId?: string): Promise<SubmissionEntity[]> {
    if (isAdminPanelOperator(user.role)) {
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

    assertStudentMaySubmitFromStatus(submission.status);

    await this.users.assertStudentProfileCompleteForSubmission(submission.userId);

    const missingProof = await this.repository.countItemsMissingProof(submissionId);
    if (missingProof > 0) {
      throw new ServiceError(
        400,
        "Every submission line must have a proof file URL before you can submit.",
        "VALIDATION_ERROR",
      );
    }

    const updated = await this.repository.updateStatus({
      id: submission.id,
      status: "submitted",
      submittedAt: true,
    });

    await this.audit.insert({
      actorUserId: user.id,
      targetUserId: updated.userId,
      entityTable: "submissions",
      entityId: updated.id,
      action: "submission_submitted",
      newValues: { status: updated.status },
    });

    this.notifications.notifySubmissionSubmitted({
      userId: updated.userId,
      submissionId: updated.id,
      title: updated.title,
    });

    return updated;
  }

  private async assertActiveSubmissionQuota(targetUserId: string, actorRole: AuthUser["role"]): Promise<void> {
    if (isAdminPanelOperator(actorRole)) {
      return;
    }

    const count = await this.repository.countActiveSubmissionsForUser(targetUserId);
    if (count >= MAX_ACTIVE_SUBMISSIONS_PER_USER) {
      throw new ServiceError(
        409,
        `You can have at most ${MAX_ACTIVE_SUBMISSIONS_PER_USER} active submissions (draft, submitted, in review, or awaiting revision).`,
        "QUOTA_EXCEEDED",
      );
    }
  }

  private async requireSubmission(submissionId: string): Promise<SubmissionEntity> {
    const submission = await this.repository.findById(submissionId);

    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    return submission;
  }

  private async assertReadAccess(user: AuthUser, submission: SubmissionEntity): Promise<void> {
    if (isAdminPanelOperator(user.role)) {
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
