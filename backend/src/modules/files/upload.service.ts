import { createHash, randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";
import type { AuthUser } from "../../types/auth-user";
import { ServiceError } from "../../utils/service-error";
import { isAdminPanelOperator } from "../../utils/admin-roles";
import type { SubmissionStatus } from "../submissions/submissions.schema";
import { assertStudentMayEditSubmissionContent } from "../submissions/submission-transitions";
import type { AntiFraudService } from "../validation/anti-fraud.service";

const TEN_MB = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export interface UploadInput {
  user: AuthUser;
  submissionId: string;
  submissionItemId?: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface UploadResult {
  id: string;
  /** Canonical public URL for the object (Supabase Storage). */
  fileUrl: string;
  fileType: string;
  size: number;
  bucket: string;
  storagePath: string;
  originalFilename: string;
  /** Time-limited URL for private buckets / immediate download. */
  signedUrl: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

interface InsertedFileRow {
  id: string;
  bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum_sha256: string | null;
}

interface SubmissionOwnershipRow {
  user_id: string;
  status: string;
}

interface ItemRow {
  id: string;
  submission_id: string;
}

function toSafeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class UploadService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly antiFraud: AntiFraudService,
  ) {}

  async uploadFile(input: UploadInput): Promise<UploadResult> {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new ServiceError(400, "Only PDF, JPG, and PNG files are allowed");
    }

    if (input.bytes.byteLength > TEN_MB) {
      throw new ServiceError(400, "File exceeds maximum size of 10MB");
    }

    const submission = await this.getSubmission(input.submissionId);
    if (!submission) {
      throw new ServiceError(404, "Submission not found");
    }

    if (!isAdminPanelOperator(input.user.role) && submission.user_id !== input.user.id) {
      throw new ServiceError(403, "You cannot upload files for another user's submission");
    }

    if (input.submissionItemId) {
      await this.assertCanLinkProofToItem({
        user: input.user,
        submissionId: input.submissionId,
        submissionStatus: submission.status,
        submissionOwnerId: submission.user_id,
        submissionItemId: input.submissionItemId,
      });
    }

    const checksum = createHash("sha256").update(input.bytes).digest("hex");

    await this.antiFraud.assertNoDuplicateFile({
      userId: submission.user_id,
      checksum,
    });

    const safeFilename = toSafeFilename(input.filename);
    const storagePath = `${submission.user_id}/${input.submissionId}/${randomUUID()}-${safeFilename}`;

    const uploadResult = await this.app.supabaseAdmin.storage
      .from(env.STORAGE_BUCKET)
      .upload(storagePath, input.bytes, {
        contentType: input.mimeType,
        upsert: false,
      });

    if (uploadResult.error) {
      this.app.log.error({ err: uploadResult.error }, "Storage upload failed");
      throw new ServiceError(500, "Storage upload failed");
    }

    const { data: publicUrlData } = this.app.supabaseAdmin.storage
      .from(env.STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const fileUrl = publicUrlData.publicUrl;

    const signedUrlResult = await this.app.supabaseAdmin.storage
      .from(env.STORAGE_BUCKET)
      .createSignedUrl(storagePath, env.STORAGE_SIGNED_URL_TTL_SECONDS);

    let signedUrl = fileUrl;
    if (!signedUrlResult.error && signedUrlResult.data?.signedUrl) {
      signedUrl = signedUrlResult.data.signedUrl;
    } else if (signedUrlResult.error) {
      this.app.log.warn({ err: signedUrlResult.error }, "Signed URL failed; falling back to public URL");
    }

    const metadata = await this.insertMetadata({
      userId: submission.user_id,
      submissionId: input.submissionId,
      submissionItemId: input.submissionItemId,
      storagePath,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      checksum,
    });

    if (input.submissionItemId) {
      await this.setSubmissionItemProofUrl(input.submissionItemId, fileUrl);
    }

    const size = metadata.size_bytes ?? input.bytes.byteLength;
    const mime = metadata.mime_type ?? input.mimeType;

    return {
      id: metadata.id,
      fileUrl,
      fileType: mime,
      size,
      bucket: metadata.bucket,
      storagePath: metadata.storage_path,
      originalFilename: metadata.original_filename,
      signedUrl,
      mimeType: mime,
      sizeBytes: size,
      checksumSha256: metadata.checksum_sha256 ?? checksum,
    };
  }

  private async getSubmission(
    submissionId: string,
  ): Promise<{ user_id: string; status: string } | null> {
    const result = await this.app.db.query<SubmissionOwnershipRow>(
      `
      SELECT user_id, status::text AS status
      FROM submissions
      WHERE id = $1
      `,
      [submissionId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return { user_id: row.user_id, status: row.status };
  }

  private async assertCanLinkProofToItem(params: {
    user: AuthUser;
    submissionId: string;
    submissionStatus: string;
    submissionOwnerId: string;
    submissionItemId: string;
  }): Promise<void> {
    if (!isAdminPanelOperator(params.user.role) && params.submissionOwnerId !== params.user.id) {
      throw new ServiceError(403, "Only the submission owner can attach proof to items");
    }

    if (!isAdminPanelOperator(params.user.role)) {
      assertStudentMayEditSubmissionContent(params.submissionStatus as SubmissionStatus);
    }

    const item = await this.app.db.query<ItemRow>(
      `
      SELECT id, submission_id
      FROM submission_items
      WHERE id = $1
      `,
      [params.submissionItemId],
    );

    const row = item.rows[0];
    if (!row) {
      throw new ServiceError(404, "Submission item not found");
    }

    if (row.submission_id !== params.submissionId) {
      throw new ServiceError(400, "Submission item does not belong to this submission");
    }
  }

  private async setSubmissionItemProofUrl(submissionItemId: string, proofUrl: string): Promise<void> {
    await this.app.db.query(
      `
      UPDATE submission_items
      SET proof_file_url = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [submissionItemId, proofUrl],
    );
  }

  private async insertMetadata(input: {
    userId: string;
    submissionId: string;
    submissionItemId?: string;
    storagePath: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  }): Promise<InsertedFileRow> {
    // Dashboard multipart flow: persists metadata in `files`. Telegram bot proofs use `submission_items.proof_file_url` only.
    const result = await this.app.db.query<InsertedFileRow>(
      `
      INSERT INTO files (
        submission_id,
        submission_item_id,
        user_id,
        bucket,
        storage_path,
        original_filename,
        mime_type,
        size_bytes,
        checksum_sha256
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, bucket, storage_path, original_filename, mime_type, size_bytes, checksum_sha256
      `,
      [
        input.submissionId,
        input.submissionItemId ?? null,
        input.userId,
        env.STORAGE_BUCKET,
        input.storagePath,
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.checksum,
      ],
    );

    return result.rows[0] as InsertedFileRow;
  }
}

export { ServiceError as FileServiceError } from "../../utils/service-error";
