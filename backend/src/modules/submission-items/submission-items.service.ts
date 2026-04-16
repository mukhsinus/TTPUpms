import type {
  SubmissionItemsRepository,
  SubmissionItemEntity,
  SubmissionOwnerEntity,
} from "./submission-items.repository";
import type { AddSubmissionItemBody } from "./submission-items.schema";
import type { ScoringRulesRepository } from "../scoring/scoring-rules.repository";
import { normalizeMetadata, resolveFixedPointsFromRules } from "../scoring/scoring-metadata";
import { isPgUniqueViolation } from "../../utils/pg-errors";
import { ServiceError } from "../../utils/service-error";
import { assertStudentMayEditSubmissionContent } from "../submissions/submission-transitions";

type Role = "student" | "reviewer" | "admin";

export interface AuthUser {
  id: string;
  role: Role;
}

export class SubmissionItemsService {
  constructor(
    private readonly repository: SubmissionItemsRepository,
    private readonly scoringRules: ScoringRulesRepository,
  ) {}

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

    const categoryTypeRaw = await this.repository.findCategoryScoringType(body.category_id);
    if (!categoryTypeRaw) {
      throw new ServiceError(400, "Unknown category");
    }
    const categoryKind = categoryTypeRaw === "manual" ? "expert" : categoryTypeRaw;

    let subcategoryId = body.subcategory_id ?? null;
    if (!subcategoryId) {
      const slug = body.subcategory?.trim();
      if (!slug) {
        throw new ServiceError(400, "Provide subcategory_id or subcategory slug", "VALIDATION_ERROR");
      }
      subcategoryId = await this.repository.findSubcategoryIdBySlug(body.category_id, slug);
      if (!subcategoryId) {
        throw new ServiceError(400, "Unknown subcategory slug for this category", "VALIDATION_ERROR");
      }
    } else {
      const ok = await this.repository.isSubcategoryUnderCategory(subcategoryId, body.category_id);
      if (!ok) {
        throw new ServiceError(400, "subcategory_id does not belong to category_id", "VALIDATION_ERROR");
      }
    }

    const metadata = normalizeMetadata(body.metadata);
    let proposedScore = body.proposed_score;

    if (categoryKind === "fixed") {
      const rules = await this.scoringRules.findRulesBySubcategoryId(subcategoryId);
      const resolved = resolveFixedPointsFromRules(metadata, rules);
      if (resolved === null) {
        throw new ServiceError(
          400,
          "metadata does not match any scoring rule for this category/subcategory",
          "VALIDATION_ERROR",
        );
      }
      proposedScore = resolved;
    } else if (proposedScore < bounds.minScore || proposedScore > bounds.maxScore) {
      throw new ServiceError(
        400,
        `proposed_score must be between ${bounds.minScore} and ${bounds.maxScore} for this category`,
        "VALIDATION_ERROR",
      );
    }

    const categoryName = await this.repository.resolveCategoryName(body.category_id);
    if (!categoryName) {
      throw new ServiceError(400, "Unknown category");
    }

    try {
      return await this.repository.createItem({
        submissionId: submission.id,
        categoryId: body.category_id,
        subcategoryId,
        title: body.title,
        description: body.description,
        proofFileUrl: body.proof_file_url,
        externalLink: body.external_link,
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
