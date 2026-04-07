import type { SubmissionsRepository, SubmissionEntity } from "./submissions.repository";
import type { NotificationService } from "../notifications/notification.service";
import type { AntiFraudService } from "../validation/anti-fraud.service";

type Role = "student" | "reviewer" | "admin";

export interface AuthUser {
  id: string;
  role: Role;
}

export interface CreateSubmissionInput {
  title: string;
  description?: string;
  userId?: string;
}

class ServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "ServiceError";
  }
}

const SUBMITTABLE_STATUSES = new Set(["draft", "needs_revision"]);

export class SubmissionsService {
  constructor(
    private readonly repository: SubmissionsRepository,
    private readonly notifications: NotificationService,
    private readonly antiFraud: AntiFraudService,
  ) {}

  async createSubmission(user: AuthUser, input: CreateSubmissionInput): Promise<SubmissionEntity> {
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
    const submission = await this.repository.findById(submissionId);

    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (user.role === "admin") {
      return submission;
    }

    if (user.role === "student") {
      if (submission.userId !== user.id) {
        throw new ServiceError(403, "You can only access your own submissions");
      }
      return submission;
    }

    const assignedSubmission = await this.repository.findReviewerAssignedById(submissionId, user.id);
    if (!assignedSubmission) {
      throw new ServiceError(403, "You can only access assigned submissions");
    }

    return submission;
  }

  async submitSubmission(user: AuthUser, submissionId: string): Promise<SubmissionEntity> {
    const submission = await this.repository.findById(submissionId);

    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (user.role !== "admin" && submission.userId !== user.id) {
      throw new ServiceError(403, "Only owner can submit this submission");
    }

    if (!SUBMITTABLE_STATUSES.has(submission.status)) {
      throw new ServiceError(
        409,
        `Invalid status transition from "${submission.status}" to "submitted"`,
      );
    }

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
}
