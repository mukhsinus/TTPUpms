import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "crypto";
import { env } from "../../config/env";

interface UserRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  email: string;
  full_name: string | null;
  telegram_id: string | null;
}

interface SubmissionRow {
  id: string;
  title: string;
  status: string;
  totalPoints: string;
  createdAt: string;
}

export interface BotUser {
  id: string;
  role: "student" | "reviewer" | "admin";
  email: string;
  fullName: string | null;
}

const TEN_MB = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function isUnsafeTelegramProofUrl(url: string): boolean {
  return /api\.telegram\.org\/file\/bot/i.test(url);
}

function isSafeProofStorageUrl(url: string): boolean {
  if (!url.startsWith(env.SUPABASE_PROJECT_URL) || !url.includes("/storage/v1/object/")) {
    return false;
  }
  return url.includes("/object/public/proofs/") || url.includes("/object/public/submission-files/");
}

function toSafeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class BotApiService {
  constructor(private readonly app: FastifyInstance) {}

  private toBotUser(row: UserRow): BotUser {
    return {
      id: row.id,
      role: row.role,
      email: row.email,
      fullName: row.full_name,
    };
  }

  async getCategoriesCatalog(): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      minScore: number;
      maxScore: number;
      subcategories: Array<{ slug: string; label: string }>;
    }>
  > {
    const result = await this.app.db.query<{
      id: string;
      name: string;
      type: string;
      min_score: string;
      max_score: string;
      slug: string | null;
      label: string | null;
      sort_order: number | null;
    }>(
      `
      SELECT
        c.id,
        c.name,
        c.type::text AS type,
        c.min_score,
        c.max_score,
        cs.slug,
        cs.label,
        cs.sort_order
      FROM categories c
      LEFT JOIN category_subcategories cs ON cs.category_id = c.id
      ORDER BY c.name ASC, cs.sort_order ASC NULLS LAST, cs.slug ASC NULLS LAST
      `,
    );

    const byId = new Map<
      string,
      {
        id: string;
        name: string;
        type: string;
        minScore: number;
        maxScore: number;
        subcategories: Array<{ slug: string; label: string }>;
      }
    >();

    for (const row of result.rows) {
      let entry = byId.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          name: row.name,
          type: row.type,
          minScore: Number(row.min_score),
          maxScore: Number(row.max_score),
          subcategories: [],
        };
        byId.set(row.id, entry);
      }
      if (row.slug && row.label) {
        entry.subcategories.push({ slug: row.slug, label: row.label });
      }
    }

    return [...byId.values()];
  }

  async createStudentSubmissionFromBot(input: {
    telegramId: string;
    categoryId: string;
    subcategory: string;
    title: string;
    description: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    if (isUnsafeTelegramProofUrl(input.proofFileUrl)) {
      throw new Error("Unsafe proof URL is not allowed");
    }
    if (!isSafeProofStorageUrl(input.proofFileUrl)) {
      throw new Error("Proof URL must be a safe storage URL");
    }

    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const cat = await client.query<{
        id: string;
        name: string;
        max_score: string;
      }>(
        `
        SELECT id, name, max_score
        FROM categories
        WHERE id = $1
        `,
        [input.categoryId],
      );

      const categoryRow = cat.rows[0];
      if (!categoryRow) {
        throw new Error("Unknown category");
      }

      const subCount = await client.query<{ c: string }>(
        `
        SELECT COUNT(*)::text AS c
        FROM category_subcategories
        WHERE category_id = $1
        `,
        [input.categoryId],
      );

      const hasSubs = Number(subCount.rows[0]?.c ?? "0") > 0;
      if (hasSubs) {
        const subCheck = await client.query<{ ok: boolean }>(
          `
          SELECT true AS ok
          FROM category_subcategories
          WHERE category_id = $1 AND slug = $2
          LIMIT 1
          `,
          [input.categoryId, input.subcategory],
        );

        if (!subCheck.rows[0]) {
          throw new Error("Invalid subcategory for this category");
        }
      }

      const proposedScore = Number(categoryRow.max_score);

      const submissionResult = await client.query<{ id: string }>(
        `
        INSERT INTO submissions (user_id, title, description, status, submitted_at)
        VALUES ($1, $2, $3, 'submitted', NOW())
        RETURNING id
        `,
        [user.id, input.title, input.description],
      );

      const submissionId = submissionResult.rows[0].id;

      await client.query(
        `
        INSERT INTO submission_items (
          submission_id,
          user_id,
          category_id,
          category,
          subcategory,
          title,
          description,
          proof_file_url,
          proposed_score
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          submissionId,
          user.id,
          input.categoryId,
          categoryRow.name,
          input.subcategory,
          input.title,
          input.description,
          input.proofFileUrl,
          proposedScore,
        ],
      );

      await client.query("COMMIT");
      this.app.log.info(
        { telegram_id: input.telegramId, user_id: user.id, submission_id: submissionId },
        "Created student submission from bot",
      );
      return { submissionId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByTelegramId(telegramId: string): Promise<BotUser | null> {
    const result = await this.app.db.query<UserRow>(
      `
      SELECT id, role, email, full_name, telegram_id
      FROM users
      WHERE telegram_id = $1::bigint
      LIMIT 1
      `,
      [telegramId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return this.toBotUser(row);
  }

  async findOrCreateUserByTelegramId(telegramId: string): Promise<BotUser> {
    const existing = await this.findUserByTelegramId(telegramId);
    if (existing) {
      this.app.log.info(
        { telegram_id: telegramId, user_id: existing.id, source: "existing" },
        "Resolved bot user mapping",
      );
      return existing;
    }

    const generatedEmail = `tg_${telegramId}@telegram.local`;
    const createdAuth = await this.app.supabaseAdmin.auth.admin.createUser({
      email: generatedEmail,
      email_confirm: true,
      app_metadata: {
        role: "student",
      },
    });

    if (createdAuth.error || !createdAuth.data.user) {
      throw new Error(`Failed to create auth user for telegram_id=${telegramId}`);
    }

    const inserted = await this.app.db.query<UserRow>(
      `
      INSERT INTO users (id, email, role, telegram_id)
      VALUES ($1, $2, 'student', $3::bigint)
      RETURNING id, role, email, full_name, telegram_id
      `,
      [createdAuth.data.user.id, generatedEmail, telegramId],
    );

    const row = inserted.rows[0];
    this.app.log.info(
      { telegram_id: telegramId, user_id: row.id, source: "created" },
      "Resolved bot user mapping",
    );
    return this.toBotUser(row);
  }

  async linkTelegramByEmail(email: string, telegramId: string): Promise<BotUser | null> {
    const result = await this.app.db.query<UserRow>(
      `
      UPDATE users
      SET telegram_id = $2::bigint, updated_at = NOW()
      WHERE lower(email) = lower($1)
      RETURNING id, role, email, full_name, telegram_id
      `,
      [email, telegramId],
    );

    const row = result.rows[0];
    if (!row) return null;

    this.app.log.info(
      { telegram_id: telegramId, user_id: row.id, source: "linked_by_email" },
      "Resolved bot user mapping",
    );
    return this.toBotUser(row);
  }

  async createAchievementSubmission(input: {
    telegramId: string;
    category: string;
    details: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    if (isUnsafeTelegramProofUrl(input.proofFileUrl)) {
      this.app.log.warn(
        { telegram_id: input.telegramId },
        "Blocked unsafe Telegram proof URL payload",
      );
      throw new Error("Unsafe proof URL is not allowed");
    }

    if (!isSafeProofStorageUrl(input.proofFileUrl)) {
      this.app.log.warn(
        { telegram_id: input.telegramId },
        "Blocked non-storage proof URL payload",
      );
      throw new Error("Proof URL must be a safe storage URL");
    }

    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const submissionResult = await client.query<{ id: string }>(
        `
        INSERT INTO submissions (user_id, title, description, status, submitted_at)
        VALUES ($1, $2, $3, 'submitted', NOW())
        RETURNING id
        `,
        [user.id, `Achievement: ${input.category}`, input.details],
      );

      const submissionId = submissionResult.rows[0].id;

      await client.query(
        `
        INSERT INTO submission_items (
          submission_id,
          user_id,
          category,
          title,
          description,
          proof_file_url,
          proposed_score
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          submissionId,
          user.id,
          input.category,
          `Achievement: ${input.category}`,
          input.details,
          input.proofFileUrl,
          0,
        ],
      );

      await client.query("COMMIT");
      this.app.log.info(
        { telegram_id: input.telegramId, user_id: user.id, submission_id: submissionId },
        "Created submission from bot request",
      );
      return { submissionId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserSubmissions(telegramId: string): Promise<SubmissionRow[]> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, title, status, total_points::text AS "totalPoints", created_at AS "createdAt"
      FROM submissions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [user.id],
    );

    return result.rows;
  }

  async getUserApprovedPoints(telegramId: string): Promise<number> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    const result = await this.app.db.query<{ total: string }>(
      `
      SELECT COALESCE(SUM(total_points), 0)::text AS total
      FROM submissions
      WHERE user_id = $1
        AND status = 'approved'
      `,
      [user.id],
    );

    return Number(result.rows[0]?.total ?? "0");
  }

  async uploadProofFileByTelegramId(input: {
    telegramId: string;
    filename: string;
    mimeType: string;
    bytes: Buffer;
  }): Promise<{ proofFileUrl: string; mimeType: string; sizeBytes: number }> {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new Error("Only PDF, JPG, and PNG files are allowed");
    }

    if (input.bytes.byteLength > TEN_MB) {
      throw new Error("File exceeds maximum size of 10MB");
    }

    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const checksum = createHash("sha256").update(input.bytes).digest("hex");
    const safeFilename = toSafeFilename(input.filename);
    const storagePath = `${user.id}/proofs/${randomUUID()}-${safeFilename}`;

    const uploadResult = await this.app.supabaseAdmin.storage.from("proofs").upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
    });

    if (uploadResult.error) {
      this.app.log.error(
        { telegram_id: input.telegramId, user_id: user.id, err: uploadResult.error.message },
        "Proof upload failed",
      );
      throw new Error("Storage upload failed");
    }

    const publicUrlResult = this.app.supabaseAdmin.storage.from("proofs").getPublicUrl(storagePath);
    const proofFileUrl = publicUrlResult.data.publicUrl;

    this.app.log.info(
      {
        telegram_id: input.telegramId,
        user_id: user.id,
        size_bytes: input.bytes.byteLength,
        mime_type: input.mimeType,
        checksum_sha256: checksum,
      },
      "Proof uploaded successfully",
    );

    return {
      proofFileUrl,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
    };
  }
}
