import type {
  SubmissionItemsRepository,
  SubmissionItemEntity,
  SubmissionOwnerEntity,
} from "./submission-items.repository";
import type { AddSubmissionItemBody } from "./submission-items.schema";
import { assertStudentMayEditSubmissionContent } from "../submissions/submission-transitions";

type Role = "student" | "reviewer" | "admin";

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

export class SubmissionItemsService {
  constructor(private readonly repository: SubmissionItemsRepository) {}

  async addItem(
    user: AuthUser,
    submissionId: string,
    body: AddSubmissionItemBody,
  ): Promise<SubmissionItemEntity> {
    const submission = await this.requireOwnedSubmissionEditableByStudent(user, submissionId);

    const bounds = await this.repository.findCategoryBounds(body.category_id);
    if (!bounds) {
      throw new ServiceError(400, "Unknown category");
    }

    if (body.proposed_score < bounds.minScore || body.proposed_score > bounds.maxScore) {
      throw new ServiceError(
        400,
        `proposed_score must be between ${bounds.minScore} and ${bounds.maxScore} for this category`,
      );
    }

    const categoryName = await this.repository.resolveCategoryName(body.category_id);
    if (!categoryName) {
      throw new ServiceError(400, "Unknown category");
    }

    return this.repository.createItem({
      submissionId: submission.id,
      userId: submission.userId,
      categoryId: body.category_id,
      categoryName,
      subcategory: body.subcategory,
      title: body.title,
      description: body.description,
      proofFileUrl: body.proof_file_url,
      externalLink: body.external_link,
      proposedScore: body.proposed_score,
    });
  }

  async listItems(user: AuthUser, submissionId: string): Promise<SubmissionItemEntity[]> {
    await this.assertCanReadSubmission(user, submissionId);
    return this.repository.findItemsBySubmissionId(submissionId);
  }

  async deleteItem(user: AuthUser, submissionId: string, itemId: string): Promise<void> {
    await this.requireOwnedSubmissionEditableByStudent(user, submissionId);
    const item = await this.assertItemBelongsToSubmission(itemId, submissionId);
    if (item.userId !== user.id) {
      throw new ServiceError(403, "Only the submission owner can delete items");
    }
    await this.repository.deleteItem(itemId);
  }

  private async requireOwnedSubmissionEditableByStudent(
    user: AuthUser,
    submissionId: string,
  ): Promise<SubmissionOwnerEntity> {
    const submission = await this.repository.findSubmissionById(submissionId);

    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (submission.userId !== user.id) {
      throw new ServiceError(403, "Only the submission owner can modify items");
    }

    assertStudentMayEditSubmissionContent(submission.status);

    return submission;
  }

  private async assertCanReadSubmission(user: AuthUser, submissionId: string): Promise<SubmissionOwnerEntity> {
    const submission = await this.repository.findSubmissionById(submissionId);

    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (user.role === "admin") {
      return submission;
    }

    if (submission.userId === user.id) {
      return submission;
    }

    if (user.role === "reviewer") {
      const assigned = await this.repository.isReviewerForSubmission(submissionId, user.id);
      if (assigned) {
        return submission;
      }
    }

    throw new ServiceError(403, "Forbidden");
  }

  private async assertItemBelongsToSubmission(
    itemId: string,
    submissionId: string,
  ): Promise<SubmissionItemEntity> {
    const item = await this.repository.findItemById(itemId);

    if (!item) {
      throw new ServiceError(404, "Submission item not found");
    }

    if (item.submissionId !== submissionId) {
      throw new ServiceError(400, "Submission item does not belong to this submission");
    }

    return item;
  }
}
