import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "crypto";
import { env } from "../../config/env";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { ScoringRulesRepository } from "../scoring/scoring-rules.repository";
import { normalizeMetadata, resolveFixedPointsFromRules } from "../scoring/scoring-metadata";
import { isPgUniqueViolation } from "../../utils/pg-errors";
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
    private readonly scoringRules: ScoringRulesRepository,
  ) {}

  private async resolveProposedScoreForBot(
    categoryId: string,
    subcategoryId: string,
    metadata: Record<string, unknown>,
  ): Promise<number> {
    const typeRow = await this.app.db.query<{ type: string; max_score: string }>(
      `
      SELECT type::text AS type, max_score::text
      FROM categories
      WHERE id = $1
      `,
      [categoryId],
    );
    const row = typeRow.rows[0];
    if (!row) {
      throw new Error("Unknown category");
    }
    const kind = row.type === "manual" ? "expert" : row.type;
    if (kind === "fixed") {
      const rules = await this.scoringRules.findRulesBySubcategoryId(subcategoryId);
      const resolved = resolveFixedPointsFromRules(metadata, rules);
      if (resolved === null) {
        throw new Error("Metadata does not match any scoring rule for this subcategory");
      }
      return resolved;
    }
    return Number(row.max_score);
  }

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
    const result = await this.app.db.query<{ id: string }>(
      `
      INSERT INTO submissions (user_id, title, description, status)
      VALUES ($1, $2, $3, 'draft')
      RETURNING id
      `,
      [user.id, draftTitle, null],
    );

    const submissionId = result.rows[0].id;
    await this.audit.insert({
      actorUserId: user.id,
      targetUserId: user.id,
      entityTable: "submissions",
      entityId: submissionId,
      action: "submission_created",
      newValues: { source: "telegram_bot", title: draftTitle, status: "draft" },
    });

    return { submissionId };
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
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const submissionLock = await client.query<{ user_id: string; status: string }>(
        `SELECT user_id, status FROM submissions WHERE id = $1 FOR UPDATE`,
        [input.submissionId],
      );

      const submission = submissionLock.rows[0];
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
      const slug = hasSubs ? input.subcategory?.trim() : "general";
      if (hasSubs && !slug) {
        throw new Error("Subcategory is required for this category");
      }

      const subcategoryRow = await client.query<{ id: string }>(
        `
        SELECT id
        FROM category_subcategories
        WHERE category_id = $1 AND slug = $2
        LIMIT 1
        `,
        [input.categoryId, slug ?? "general"],
      );

      if (!subcategoryRow.rows[0]) {
        throw new Error("Invalid subcategory for this category");
      }

      const subcategoryId = subcategoryRow.rows[0].id;
      const metadata = normalizeMetadata(input.metadata);
      const proposedScore = await this.resolveProposedScoreForBot(input.categoryId, subcategoryId, metadata);

      const ext =
        input.externalLink && input.externalLink.trim() !== "" ? input.externalLink.trim() : null;

      const insert = await client.query<{ id: string }>(
        `
        INSERT INTO submission_items (
          submission_id,
          user_id,
          category_id,
          category,
          subcategory_id,
          title,
          description,
          proof_file_url,
          external_link,
          proposed_score,
          metadata,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'pending')
        RETURNING id
        `,
        [
          input.submissionId,
          user.id,
          input.categoryId,
          categoryRow.name,
          subcategoryId,
          input.title,
          input.description,
          input.proofFileUrl,
          ext,
          proposedScore,
          JSON.stringify(metadata),
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
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      if (isPgUniqueViolation(error)) {
        throw new BotApiHttpError(
          409,
          "This achievement line already exists on this submission (same category, subcategory, and title).",
          "DUPLICATE_ITEM",
        );
      }
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

      const proofCheck = await client.query<{ c: string }>(
        `
        SELECT COUNT(*)::text AS c
        FROM submission_items
        WHERE submission_id = $1
          AND (proof_file_url IS NULL OR btrim(proof_file_url) = '')
        `,
        [submissionId],
      );
      if (Number(proofCheck.rows[0]?.c ?? "0") > 0) {
        throw new Error("Each line must include a proof file before submitting");
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

      await this.audit.insert({
        actorUserId: user.id,
        targetUserId: user.id,
        entityTable: "submissions",
        entityId: submissionId,
        action: "submission_submitted",
        newValues: { source: "telegram_bot", status: "submitted" },
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
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
    metadata?: Record<string, unknown>;
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
      const slug = hasSubs ? input.subcategory.trim() : "general";
      if (hasSubs && !input.subcategory?.trim()) {
        throw new Error("Subcategory is required for this category");
      }

      const subcategoryRow = await client.query<{ id: string }>(
        `
        SELECT id
        FROM category_subcategories
        WHERE category_id = $1 AND slug = $2
        LIMIT 1
        `,
        [input.categoryId, slug],
      );

      if (!subcategoryRow.rows[0]) {
        throw new Error("Invalid subcategory for this category");
      }

      const subcategoryId = subcategoryRow.rows[0].id;
      const metadata = normalizeMetadata(input.metadata);
      const proposedScore = await this.resolveProposedScoreForBot(input.categoryId, subcategoryId, metadata);

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
          subcategory_id,
          title,
          description,
          proof_file_url,
          proposed_score,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        `,
        [
          submissionId,
          user.id,
          input.categoryId,
          categoryRow.name,
          subcategoryId,
          input.title,
          input.description,
          input.proofFileUrl,
          proposedScore,
          JSON.stringify(metadata),
        ],
      );

      await client.query("COMMIT");
      this.app.log.info(
        { telegram_id: input.telegramId, user_id: user.id, submission_id: submissionId },
        "Created student submission from bot",
      );
      return { submissionId };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
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

      let catRes = await client.query<{ id: string; name: string }>(
        `
        SELECT id, name
        FROM categories
        WHERE name = $1
        LIMIT 1
        `,
        [input.category],
      );
      if (!catRes.rows[0]) {
        catRes = await client.query<{ id: string; name: string }>(
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
        throw new Error("Unknown category for achievement");
      }

      const genSub = await client.query<{ id: string }>(
        `
        SELECT id
        FROM category_subcategories
        WHERE category_id = $1 AND slug = 'general'
        LIMIT 1
        `,
        [categoryRow.id],
      );
      const defaultSubId = genSub.rows[0]?.id;
      if (!defaultSubId) {
        throw new Error("Category is missing default subcategory");
      }

      const achievementMeta: Record<string, unknown> = {};
      const proposedScore = await this.resolveProposedScoreForBot(
        categoryRow.id,
        defaultSubId,
        achievementMeta,
      );

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
          category_id,
          category,
          subcategory_id,
          title,
          description,
          proof_file_url,
          proposed_score,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        `,
        [
          submissionId,
          user.id,
          categoryRow.id,
          categoryRow.name,
          defaultSubId,
          `Achievement: ${input.category}`,
          input.details,
          input.proofFileUrl,
          proposedScore,
          JSON.stringify(achievementMeta),
        ],
      );

      await client.query("COMMIT");
      this.app.log.info(
        { telegram_id: input.telegramId, user_id: user.id, submission_id: submissionId },
        "Created submission from bot request",
      );
      return { submissionId };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
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
