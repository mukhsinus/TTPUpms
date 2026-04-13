import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "crypto";
import { env } from "../../config/env";

interface UserRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  full_name: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
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
  telegramUsername: string | null;
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

function isMissingRelationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

export class BotApiService {
  private telegramUsernameColumnAvailable: boolean | null = null;

  constructor(private readonly app: FastifyInstance) {}

  private async hasTelegramUsernameColumn(): Promise<boolean> {
    if (this.telegramUsernameColumnAvailable !== null) {
      return this.telegramUsernameColumnAvailable;
    }
    const check = await this.app.db.query<{ exists: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'telegram_username'
      ) AS exists
      `,
    );
    this.telegramUsernameColumnAvailable = Boolean(check.rows[0]?.exists);
    return this.telegramUsernameColumnAvailable;
  }

  private toBotUser(row: UserRow): BotUser {
    return {
      id: row.id,
      role: row.role,
      telegramUsername: row.telegram_username,
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
    let result;
    try {
      result = await this.app.db.query<{
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
    } catch (error) {
      if (isMissingRelationError(error)) {
        this.app.log.warn("categories tables are not available yet; returning empty catalog");
        return [];
      }
      throw error;
    }

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

  /** Draft submission for Telegram multi-item flow (POST /api/submissions equivalent). */
  async createDraftSubmissionForBot(telegramId: string): Promise<{ submissionId: string }> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    const result = await this.app.db.query<{ id: string }>(
      `
      INSERT INTO submissions (user_id, title, description, status)
      VALUES ($1, $2, $3, 'draft')
      RETURNING id
      `,
      [user.id, "Telegram achievement submission", null],
    );

    return { submissionId: result.rows[0].id };
  }

  /**
   * Add one line item to a draft submission (POST /api/submission-items equivalent).
   */
  async addSubmissionItemFromBot(input: {
    telegramId: string;
    submissionId: string;
    categoryId: string;
    subcategory: string | null;
    title: string;
    description: string;
    proofFileUrl: string;
    externalLink?: string | null;
  }): Promise<{ itemId: string }> {
    this.validateProofStorageUrl(input.proofFileUrl);

    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const subRow = await client.query<{ user_id: string; status: string }>(
        `SELECT user_id, status FROM submissions WHERE id = $1 FOR UPDATE`,
        [input.submissionId],
      );

      const submission = subRow.rows[0];
      if (!submission) {
        throw new Error("Submission not found");
      }
      if (submission.user_id !== user.id) {
        throw new Error("You cannot modify this submission");
      }
      if (submission.status !== "draft" && submission.status !== "needs_revision") {
        throw new Error("Items can only be added while the submission is a draft");
      }

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
      let subcategoryValue: string | null = input.subcategory;

      if (hasSubs) {
        if (!input.subcategory) {
          throw new Error("Subcategory is required for this category");
        }
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
      } else {
        subcategoryValue = input.subcategory ?? "general";
      }

      const proposedScore = Number(categoryRow.max_score);

      const ext =
        input.externalLink && input.externalLink.trim() !== "" ? input.externalLink.trim() : null;

      const insert = await client.query<{ id: string }>(
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
          external_link,
          proposed_score,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        RETURNING id
        `,
        [
          input.submissionId,
          user.id,
          input.categoryId,
          categoryRow.name,
          subcategoryValue,
          input.title,
          input.description,
          input.proofFileUrl,
          ext,
          proposedScore,
        ],
      );

      await client.query("COMMIT");
      this.app.log.info(
        {
          telegram_id: input.telegramId,
          user_id: user.id,
          submission_id: input.submissionId,
          item_id: insert.rows[0].id,
        },
        "Added submission item from bot",
      );

      return { itemId: insert.rows[0].id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** PATCH /api/submissions/:id/submit equivalent for Telegram bot. */
  async submitDraftFromBot(telegramId: string, submissionId: string): Promise<void> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);

    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const subRow = await client.query<{ user_id: string; status: string; title: string }>(
        `SELECT user_id, status, title FROM submissions WHERE id = $1 FOR UPDATE`,
        [submissionId],
      );

      const submission = subRow.rows[0];
      if (!submission) {
        throw new Error("Submission not found");
      }
      if (submission.user_id !== user.id) {
        throw new Error("Only the submission owner can submit");
      }

      if (submission.status !== "draft" && submission.status !== "needs_revision") {
        throw new Error(`Submit is not allowed from status "${submission.status}"`);
      }

      const itemsCount = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM submission_items WHERE submission_id = $1`,
        [submissionId],
      );

      if (Number(itemsCount.rows[0]?.c ?? "0") < 1) {
        throw new Error("Add at least one achievement item before submitting");
      }

      await client.query(
        `
        UPDATE submissions
        SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
        WHERE id = $1
        `,
        [submissionId],
      );

      await client.query("COMMIT");

      this.app.log.info(
        { telegram_id: telegramId, user_id: user.id, submission_id: submissionId },
        "Bot submitted draft submission",
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private validateProofStorageUrl(url: string): void {
    if (isUnsafeTelegramProofUrl(url)) {
      throw new Error("Unsafe proof URL is not allowed");
    }
    if (!isSafeProofStorageUrl(url)) {
      throw new Error("Proof URL must be a safe storage URL");
    }
  }

  async createStudentSubmissionFromBot(input: {
    telegramId: string;
    categoryId: string;
    subcategory: string;
    title: string;
    description: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    this.validateProofStorageUrl(input.proofFileUrl);

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

  async findUserByTelegramId(
    telegramId: string,
    identity?: { telegramUsername: string | null; fullName: string | null },
  ): Promise<BotUser | null> {
    const hasTelegramUsername = await this.hasTelegramUsernameColumn();
    const telegramUsernameSelect = hasTelegramUsername
      ? "telegram_username"
      : "NULL::text AS telegram_username";
    const result = await this.app.db.query<UserRow>(
      `
      SELECT id, role, full_name, telegram_id, ${telegramUsernameSelect}
      FROM users
      WHERE telegram_id = $1::bigint
      LIMIT 1
      `,
      [telegramId],
    );

    const row = result.rows[0];
    if (!row) return null;

    if (identity) {
      const nextUsername = identity.telegramUsername ? identity.telegramUsername.trim() : null;
      const nextFullName = identity.fullName ? identity.fullName.trim() : null;
      const shouldUpdateUsername =
        hasTelegramUsername && Boolean(nextUsername && nextUsername !== row.telegram_username);
      const shouldUpdateFullName = Boolean(nextFullName && nextFullName !== row.full_name);
      if (shouldUpdateUsername || shouldUpdateFullName) {
        const updates: string[] = [];
        const params: Array<string | null> = [row.id];
        let i = 2;
        if (shouldUpdateUsername) {
          updates.push(`telegram_username = $${i++}`);
          params.push(nextUsername);
        }
        if (shouldUpdateFullName) {
          updates.push(`full_name = $${i++}`);
          params.push(nextFullName);
        }
        await this.app.db.query(
          `
          UPDATE users
          SET ${updates.join(", ")}, updated_at = NOW()
          WHERE id = $1
          `,
          params,
        );
        if (shouldUpdateUsername) {
          row.telegram_username = nextUsername ?? row.telegram_username;
        }
        row.full_name = nextFullName ?? row.full_name;
      }
    }

    return this.toBotUser(row);
  }

  async findOrCreateUserByTelegramId(
    telegramId: string,
    identity?: { telegramUsername: string | null; fullName: string | null },
  ): Promise<BotUser> {
    const existing = await this.findUserByTelegramId(telegramId, identity);
    if (existing) {
      this.app.log.info(
        { telegram_id: telegramId, user_id: existing.id, source: "existing" },
        "Resolved bot user mapping",
      );
      return existing;
    }

    throw new Error("Telegram account is not linked. Please link via email first.");
  }

  async linkTelegramByEmail(
    email: string,
    telegramId: string,
    identity?: { telegramUsername: string | null; fullName: string | null },
  ): Promise<BotUser | null> {
    const hasTelegramUsername = await this.hasTelegramUsernameColumn();
    const nextUsername = identity?.telegramUsername ? identity.telegramUsername.trim() : null;
    const nextFullName = identity?.fullName ? identity.fullName.trim() : null;
    const telegramUsernameUpdate = hasTelegramUsername
      ? "telegram_username = COALESCE($3, telegram_username),"
      : "";
    const telegramUsernameSelect = hasTelegramUsername
      ? "telegram_username"
      : "NULL::text AS telegram_username";
    const result = await this.app.db.query<UserRow>(
      `
      UPDATE users
      SET telegram_id = $2::bigint,
          ${telegramUsernameUpdate}
          full_name = COALESCE($4, full_name),
          updated_at = NOW()
      WHERE lower(email) = lower($1)
      RETURNING id, role, full_name, telegram_id, ${telegramUsernameSelect}
      `,
      [email, telegramId, nextUsername, nextFullName],
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
