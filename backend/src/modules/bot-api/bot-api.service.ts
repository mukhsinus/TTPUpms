import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "crypto";
import { env } from "../../config/env";
import type { AuthUser } from "../../types/auth-user";
import { ServiceError } from "../../utils/service-error";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import { normalizeMetadata } from "../scoring/scoring-metadata";
import type { SubmissionItemsService } from "../submission-items/submission-items.service";
import type { SubmissionsService } from "../submissions/submissions.service";
import { AntiFraudError, type AntiFraudService } from "../validation/anti-fraud.service";
import { BotApiHttpError } from "./bot-api-errors";

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

function toAuthUser(user: BotUser): AuthUser {
  return { id: user.id, role: user.role };
}

function toBotApiError(error: unknown): BotApiHttpError {
  if (error instanceof ServiceError) {
    return new BotApiHttpError(error.statusCode, error.message, error.clientCode ?? "SERVICE_ERROR");
  }
  if (error instanceof AntiFraudError) {
    return new BotApiHttpError(error.statusCode, error.message, "ANTI_FRAUD");
  }
  if (error instanceof Error) {
    return new BotApiHttpError(500, error.message, "INTERNAL_SERVER_ERROR");
  }
  return new BotApiHttpError(500, "Unexpected error", "INTERNAL_SERVER_ERROR");
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

  constructor(
    private readonly app: FastifyInstance,
    private readonly audit: AuditLogRepository,
    private readonly submissions: SubmissionsService,
    private readonly submissionItems: SubmissionItemsService,
    private readonly antiFraud: AntiFraudService,
  ) {}

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

  /** Keeps Supabase JWT app_metadata.role aligned with public.users.role after linking. */
  private async syncAuthAppMetadataRoleFromDb(userId: string, role: UserRow["role"]): Promise<void> {
    try {
      const { data, error } = await this.app.supabaseAdmin.auth.admin.getUserById(userId);
      if (error || !data?.user) {
        this.app.log.warn({ userId, err: error?.message }, "syncAuthAppMetadataRole: could not load auth user");
        return;
      }
      const current = data.user.app_metadata?.role;
      if (current === role) {
        return;
      }
      const { error: updateError } = await this.app.supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: { ...data.user.app_metadata, role },
      });
      if (updateError) {
        this.app.log.warn({ userId, err: updateError.message }, "syncAuthAppMetadataRole: updateUserById failed");
      }
    } catch (err) {
      this.app.log.warn({ err, userId }, "syncAuthAppMetadataRole: unexpected error");
    }
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
    const draftTitle = `Telegram submission ${randomUUID().slice(0, 8)}`;
    try {
      const created = await this.submissions.createSubmission(toAuthUser(user), {
        title: draftTitle,
        description: undefined,
      });
      return { submissionId: created.id };
    } catch (error) {
      throw toBotApiError(error);
    }
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
    metadata?: Record<string, unknown>;
  }): Promise<{ itemId: string }> {
    this.validateProofStorageUrl(input.proofFileUrl);

    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const slug = await this.resolveBotSubcategorySlug(input.categoryId, input.subcategory);
    const ext =
      input.externalLink && input.externalLink.trim() !== "" ? input.externalLink.trim() : undefined;

    try {
      const item = await this.submissionItems.addItem(toAuthUser(user), input.submissionId, {
        category_id: input.categoryId,
        subcategory: slug,
        title: input.title,
        description: input.description,
        proof_file_url: input.proofFileUrl,
        external_link: ext,
        proposed_score: 0,
        metadata: normalizeMetadata(input.metadata) as Record<string, string | number | boolean>,
      });

      this.app.log.info(
        {
          telegram_id: input.telegramId,
          user_id: user.id,
          submission_id: input.submissionId,
          item_id: item.id,
        },
        "Added submission item from bot",
      );

      return { itemId: item.id };
    } catch (error) {
      throw toBotApiError(error);
    }
  }

  /** PATCH /api/submissions/:id/submit equivalent for Telegram bot. */
  async submitDraftFromBot(telegramId: string, submissionId: string): Promise<void> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    try {
      await this.submissions.submitSubmission(toAuthUser(user), submissionId);
      this.app.log.info(
        { telegram_id: telegramId, user_id: user.id, submission_id: submissionId },
        "Bot submitted draft submission",
      );
    } catch (error) {
      throw toBotApiError(error);
    }
  }

  private async resolveBotSubcategorySlug(categoryId: string, subcategory: string | null): Promise<string> {
    const subCount = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM category_subcategories
      WHERE category_id = $1
      `,
      [categoryId],
    );

    const hasSubs = Number(subCount.rows[0]?.c ?? "0") > 0;
    if (!hasSubs) {
      return "general";
    }

    const slug = subcategory?.trim() ?? "";
    if (!slug) {
      throw new BotApiHttpError(400, "Subcategory is required for this category", "VALIDATION_ERROR");
    }

    return slug;
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
    metadata?: Record<string, unknown>;
  }): Promise<{ submissionId: string }> {
    this.validateProofStorageUrl(input.proofFileUrl);

    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const auth = toAuthUser(user);
    const slug = await this.resolveBotSubcategorySlug(input.categoryId, input.subcategory);

    try {
      const created = await this.submissions.createSubmission(auth, {
        title: input.title,
        description: input.description,
      });

      await this.submissionItems.addItem(auth, created.id, {
        category_id: input.categoryId,
        subcategory: slug,
        title: input.title,
        description: input.description,
        proof_file_url: input.proofFileUrl,
        proposed_score: 0,
        metadata: normalizeMetadata(input.metadata) as Record<string, string | number | boolean>,
      });

      await this.submissions.submitSubmission(auth, created.id);

      this.app.log.info(
        { telegram_id: input.telegramId, user_id: user.id, submission_id: created.id },
        "Created student submission from bot",
      );
      return { submissionId: created.id };
    } catch (error) {
      throw toBotApiError(error);
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
    try {
      const hasTelegramUsername = await this.hasTelegramUsernameColumn();
      const nextUsername = identity?.telegramUsername ? identity.telegramUsername.trim() : null;
      const nextFullName = identity?.fullName ? identity.fullName.trim() : null;

      const result = hasTelegramUsername
        ? await this.app.db.query<UserRow>(
            `
            UPDATE users
            SET telegram_id = $2::bigint,
                telegram_username = COALESCE($3, telegram_username),
                full_name = COALESCE($4, full_name),
                updated_at = NOW()
            WHERE lower(email) = lower($1)
            RETURNING id, role, full_name, telegram_id, telegram_username
            `,
            [email, telegramId, nextUsername, nextFullName],
          )
        : await this.app.db.query<UserRow>(
            `
            UPDATE users
            SET telegram_id = $2::bigint,
                full_name = COALESCE($3, full_name),
                updated_at = NOW()
            WHERE lower(email) = lower($1)
            RETURNING id, role, full_name, telegram_id, NULL::text AS telegram_username
            `,
            [email, telegramId, nextFullName],
          );

      const row = result.rows[0];
      if (!row) return null;

      await this.syncAuthAppMetadataRoleFromDb(row.id, row.role);

      this.app.log.info(
        { telegram_id: telegramId, user_id: row.id, source: "linked_by_email" },
        "Resolved bot user mapping",
      );
      return this.toBotUser(row);
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: unknown }).code)
          : undefined;
      const emailDomain = email.includes("@") ? email.split("@")[1] : "invalid";
      this.app.log.error({ err, code, emailDomain }, "linkTelegramByEmail: database or auth sync failed");
      throw err;
    }
  }

  async createAchievementSubmission(input: {
    telegramId: string;
    category: string;
    details: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    this.validateProofStorageUrl(input.proofFileUrl);

    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const auth = toAuthUser(user);

    let catRes = await this.app.db.query<{ id: string; name: string }>(
      `
      SELECT id, name
      FROM categories
      WHERE name = $1
      LIMIT 1
      `,
      [input.category],
    );
    if (!catRes.rows[0]) {
      catRes = await this.app.db.query<{ id: string; name: string }>(
        `
        SELECT id, name
        FROM categories
        WHERE name = 'legacy_uncategorized'
        LIMIT 1
        `,
      );
    }
    const categoryRow = catRes.rows[0];
    if (!categoryRow) {
      throw new BotApiHttpError(400, "Unknown category for achievement", "VALIDATION_ERROR");
    }

    const genSub = await this.app.db.query<{ id: string }>(
      `
      SELECT id
      FROM category_subcategories
      WHERE category_id = $1 AND slug = 'general'
      LIMIT 1
      `,
      [categoryRow.id],
    );
    if (!genSub.rows[0]) {
      throw new BotApiHttpError(400, "Category is missing default subcategory", "VALIDATION_ERROR");
    }

    try {
      const created = await this.submissions.createSubmission(auth, {
        title: `Achievement: ${input.category}`,
        description: input.details,
      });

      await this.submissionItems.addItem(auth, created.id, {
        category_id: categoryRow.id,
        subcategory: "general",
        title: `Achievement: ${input.category}`,
        description: input.details,
        proof_file_url: input.proofFileUrl,
        proposed_score: 0,
        metadata: {},
      });

      await this.submissions.submitSubmission(auth, created.id);

      this.app.log.info(
        { telegram_id: input.telegramId, user_id: user.id, submission_id: created.id },
        "Created submission from bot request",
      );
      return { submissionId: created.id };
    } catch (error) {
      throw toBotApiError(error);
    }
  }

  async getUserSubmissions(telegramId: string): Promise<SubmissionRow[]> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, title, status, total_score::text AS "totalPoints", created_at AS "createdAt"
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
      SELECT COALESCE(SUM(total_score), 0)::text AS total
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
    await this.antiFraud.assertNoDuplicateFile({ userId: user.id, checksum });
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
