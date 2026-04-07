import type {
  SubmissionItemsRepository,
  SubmissionItemEntity,
  SubmissionOwnerEntity,
} from "./submission-items.repository";
import type { AddSubmissionItemBody, UpdateSubmissionItemBody } from "./submission-items.schema";
import type { AntiFraudService } from "../validation/anti-fraud.service";
import { env } from "../../config/env";

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

function isUnsafeTelegramProofUrl(url: string): boolean {
  return /api\.telegram\.org\/file\/bot/i.test(url);
}

function isSafeStorageUrl(url: string): boolean {
  return url.startsWith(env.SUPABASE_PROJECT_URL) && url.includes("/storage/v1/object/");
}

export class SubmissionItemsService {
  constructor(
    private readonly repository: SubmissionItemsRepository,
    private readonly antiFraud: AntiFraudService,
  ) {}

  async addItem(
    user: AuthUser,
    submissionId: string,
    body: AddSubmissionItemBody,
  ): Promise<SubmissionItemEntity> {
    const submission = await this.assertSubmissionCanBeModified(user, submissionId);
    this.antiFraud.assertValidActivityDate(body.activity_date);

    return this.repository.createItem({
      submissionId: submission.id,
      userId: submission.userId,
      category: body.category,
      subcategory: body.subcategory,
      activityDate: body.activity_date,
      title: body.title,
      description: body.description,
      proposedScore: body.proposed_score,
    });
  }

  async updateItem(
    user: AuthUser,
    submissionId: string,
    itemId: string,
    body: UpdateSubmissionItemBody,
  ): Promise<SubmissionItemEntity> {
    await this.assertSubmissionCanBeModified(user, submissionId);
    const item = await this.assertItemBelongsToSubmission(itemId, submissionId);
    this.antiFraud.assertValidActivityDate(body.activity_date);

    return this.repository.updateItem(item.id, {
      category: body.category,
      subcategory: body.subcategory,
      activityDate: body.activity_date,
      title: body.title,
      description: body.description,
      proposedScore: body.proposed_score,
    });
  }

  async deleteItem(user: AuthUser, submissionId: string, itemId: string): Promise<void> {
    await this.assertSubmissionCanBeModified(user, submissionId);
    await this.assertItemBelongsToSubmission(itemId, submissionId);
    await this.repository.deleteItem(itemId);
  }

  async attachFile(
    user: AuthUser,
    submissionId: string,
    itemId: string,
    proofFileUrl: string,
  ): Promise<SubmissionItemEntity> {
    await this.assertSubmissionCanBeModified(user, submissionId);
    const item = await this.assertItemBelongsToSubmission(itemId, submissionId);
    if (isUnsafeTelegramProofUrl(proofFileUrl)) {
      throw new ServiceError(400, "Telegram file URLs are not allowed");
    }
    if (!isSafeStorageUrl(proofFileUrl)) {
      throw new ServiceError(400, "proof_file_url must be a safe storage URL");
    }

    return this.repository.updateProofFileUrl(item.id, proofFileUrl);
  }

  async addExternalLink(
    user: AuthUser,
    submissionId: string,
    itemId: string,
    externalLinkUrl: string,
  ): Promise<SubmissionItemEntity> {
    await this.assertSubmissionCanBeModified(user, submissionId);
    const item = await this.assertItemBelongsToSubmission(itemId, submissionId);
    if (isUnsafeTelegramProofUrl(externalLinkUrl)) {
      throw new ServiceError(400, "Telegram file URLs are not allowed");
    }

    return this.repository.updateProofFileUrl(item.id, externalLinkUrl);
  }

  private async assertSubmissionCanBeModified(
    user: AuthUser,
    submissionId: string,
  ): Promise<SubmissionOwnerEntity> {
    const submission = await this.repository.findSubmissionById(submissionId);

    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (submission.status !== "draft") {
      throw new ServiceError(409, "Items cannot be modified after submission is sent");
    }

    if (user.role !== "admin" && submission.userId !== user.id) {
      throw new ServiceError(403, "Only owner can edit draft submission items");
    }

    return submission;
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
