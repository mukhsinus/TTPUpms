import { createHash, randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";
import type { AntiFraudService } from "../validation/anti-fraud.service";

const TEN_MB = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

type Role = "student" | "reviewer" | "admin";

interface AuthUser {
  id: string;
  role: Role;
}

interface UploadInput {
  user: AuthUser;
  submissionId: string;
  submissionItemId?: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

interface UploadResult {
  id: string;
  bucket: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  signedUrl: string;
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
}

class ServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function toSafeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class FileService {
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

    const submissionOwner = await this.getSubmissionOwner(input.submissionId);
    if (!submissionOwner) {
      throw new ServiceError(404, "Submission not found");
    }

    if (input.user.role !== "admin" && submissionOwner.user_id !== input.user.id) {
      throw new ServiceError(403, "You cannot upload files for another user's submission");
    }

    const checksum = createHash("sha256").update(input.bytes).digest("hex");

    await this.antiFraud.assertNoDuplicateFile({
      userId: submissionOwner.user_id,
      checksum,
      filename: input.filename,
    });

    const safeFilename = toSafeFilename(input.filename);
    const storagePath = `${submissionOwner.user_id}/${input.submissionId}/${randomUUID()}-${safeFilename}`;

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

    const signedUrlResult = await this.app.supabaseAdmin.storage
      .from(env.STORAGE_BUCKET)
      .createSignedUrl(storagePath, env.STORAGE_SIGNED_URL_TTL_SECONDS);

    if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
      throw new ServiceError(500, "Failed to generate secure file URL");
    }

    const metadata = await this.insertMetadata({
      userId: submissionOwner.user_id,
      submissionId: input.submissionId,
      submissionItemId: input.submissionItemId,
      storagePath,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      checksum,
    });

    return {
      id: metadata.id,
      bucket: metadata.bucket,
      storagePath: metadata.storage_path,
      originalFilename: metadata.original_filename,
      mimeType: metadata.mime_type ?? input.mimeType,
      sizeBytes: metadata.size_bytes ?? input.bytes.byteLength,
      checksumSha256: metadata.checksum_sha256 ?? checksum,
      signedUrl: signedUrlResult.data.signedUrl,
    };
  }

  private async getSubmissionOwner(submissionId: string): Promise<SubmissionOwnershipRow | null> {
    const result = await this.app.db.query<SubmissionOwnershipRow>(
      `
      SELECT user_id
      FROM submissions
      WHERE id = $1
      `,
      [submissionId],
    );

    return result.rows[0] ?? null;
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

export { ServiceError as FileServiceError };
