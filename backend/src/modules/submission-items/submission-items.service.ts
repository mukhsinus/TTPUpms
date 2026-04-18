import type {
  SubmissionItemsRepository,
  SubmissionItemEntity,
  SubmissionOwnerEntity,
} from "./submission-items.repository";
import type { AddSubmissionItemBody } from "./submission-items.schema";
import { normalizeExternalLinkForPersistence } from "./external-link-normalize";
import { normalizeMetadata } from "../scoring/scoring-metadata";
import { isPgUniqueViolation } from "../../utils/pg-errors";
import { ServiceError } from "../../utils/service-error";
import { isAdminPanelOperator } from "../../utils/admin-roles";
import type { AuthUser } from "../../types/auth-user";
import type { UsersRepository } from "../users/users.repository";
import { assertStudentMayEditSubmissionContent } from "../submissions/submission-transitions";
import { assertValidProofReference, normalizeProofReferenceForDb } from "../files/proof-reference";

export class SubmissionItemsService {
  constructor(
    private readonly repository: SubmissionItemsRepository,
    private readonly users: UsersRepository,
  ) {}

  async categoryHasSubcategories(categoryId: string): Promise<boolean> {
    return this.repository.categoryHasSubcategories(categoryId);
  }

  async addItem(
    user: AuthUser,
    submissionId: string,
    body: AddSubmissionItemBody,
  ): Promise<SubmissionItemEntity> {
    const submission = await this.requireOwnedSubmissionEditableByStudent(user, submissionId);

    await this.users.assertStudentProfileCompleteForSubmission(submission.userId);

    let subcategoryId = body.subcategory_id ?? null;
    if (subcategoryId) {
      const ok = await this.repository.isSubcategoryUnderCategory(subcategoryId, body.category_id);
      if (!ok) {
        throw new ServiceError(400, "subcategory_id does not belong to category_id", "VALIDATION_ERROR");
      }
    } else {
      const slug = body.subcategory?.trim() ?? "";
      if (slug !== "") {
        subcategoryId = await this.repository.findSubcategoryIdBySlug(body.category_id, slug);
        if (!subcategoryId) {
          throw new ServiceError(400, "Unknown subcategory slug for this category", "VALIDATION_ERROR");
        }
      }
    }

    const hasSubcategories = await this.repository.categoryHasSubcategories(body.category_id);
    if (subcategoryId === null && hasSubcategories) {
      throw new ServiceError(400, "Subcategory is required for this category", "VALIDATION_ERROR");
    }

    const metadata = normalizeMetadata(body.metadata);

    const categoryName = await this.repository.resolveCategoryName(body.category_id);
    if (!categoryName) {
      throw new ServiceError(400, "Unknown category");
    }

    if (categoryName === "olympiads" && subcategoryId) {
      const subSlug = await this.repository.findSubcategorySlugById(subcategoryId);
      if (subSlug === "olympiad_participation") {
        const p = metadata.place;
        const placeOk =
          p === 1 ||
          p === 2 ||
          p === 3 ||
          p === "1" ||
          p === "2" ||
          p === "3";
        if (!placeOk) {
          throw new ServiceError(
            400,
            "Olympiad items require metadata.place of 1, 2, or 3",
            "VALIDATION_ERROR",
          );
        }
      }
    }

    const externalLink = normalizeExternalLinkForPersistence(body.external_link);
    const proposedScore: number | null = null;

    let proofPath: string | undefined;
    if (body.proof_file_url !== undefined && body.proof_file_url.length > 0) {
      try {
        assertValidProofReference(body.proof_file_url);
        proofPath = normalizeProofReferenceForDb(body.proof_file_url, submission.userId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Invalid proof file reference";
        throw new ServiceError(400, msg, "VALIDATION_ERROR");
      }
    }

    try {
      return await this.repository.createItem({
        submissionId: submission.id,
        categoryId: body.category_id,
        subcategoryId,
        title: body.title,
        description: body.description,
        proofFileUrl: proofPath,
        externalLink,
        proposedScore,
        metadata,
      });
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new ServiceError(
          409,
          "A line with the same category, subcategory, and title already exists on this submission.",
          "DUPLICATE_ITEM",
        );
      }
      throw err;
    }
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

    if (isAdminPanelOperator(user.role)) {
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
