import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, randomUUID } from "crypto";
import { env } from "../../config/env";
import type { AuthUser } from "../../types/auth-user";
import { ServiceError } from "../../utils/service-error";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import { normalizeMetadata } from "../scoring/scoring-metadata";
import type { SubmissionItemsService } from "../submission-items/submission-items.service";
import type { SubmissionsService } from "../submissions/submissions.service";
import type { UsersRepository } from "../users/users.repository";
import { AntiFraudError, type AntiFraudService } from "../validation/anti-fraud.service";
import { BotApiHttpError } from "./bot-api-errors";

function parseUserRole(value: string): "student" | "reviewer" | "admin" {
  if (value === "student" || value === "reviewer" || value === "admin") {
    return value;
  }
  return "student";
}

interface UserRow {
  id: string;
  role: string;
  full_name: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  student_full_name: string | null;
  faculty: string | null;
  student_id: string | null;
  degree: string | null;
  is_profile_completed: boolean;
}

export interface BotSubmissionListRow {
  id: string;
  title: string;
  status: string;
  totalPoints: string;
  createdAt: string;
  studentFullName: string | null;
  faculty: string | null;
  studentId: string | null;
}

export interface BotUser {
  id: string;
  role: "student" | "reviewer" | "admin";
  telegramUsername: string | null;
  fullName: string | null;
  studentFullName: string | null;
  faculty: string | null;
  studentId: string | null;
  degree: "bachelor" | "master" | null;
  isProfileCompleted: boolean;
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

/** PostgreSQL undefined_column — e.g. SELECT references a column not yet migrated. */
function isPgUndefinedColumnError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  );
}

export class BotApiService {
  private telegramUsernameColumnAvailable: boolean | null = null;
  /** When true, all five student profile columns are present (cached after information_schema check). */
  private studentProfileColumnsFullyPresentCached: true | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly audit: AuditLogRepository,
    private readonly submissions: SubmissionsService,
    private readonly submissionItems: SubmissionItemsService,
    private readonly antiFraud: AntiFraudService,
    private readonly usersRepository: UsersRepository,
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

  private invalidateStudentProfileColumnCache(): void {
    this.studentProfileColumnsFullyPresentCached = null;
  }

  private logProfileSchemaMismatch(error: unknown, queryContext: string): void {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    const column =
      typeof error === "object" && error !== null && "column" in error
        ? String((error as { column?: unknown }).column)
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    this.app.log.warn(
      {
        event: "db_schema_mismatch",
        queryContext,
        err: { code, column, message },
      },
      "PostgreSQL undefined column (42703); using SQL fallback without student profile columns",
    );
  }

  /**
   * True when all five student profile columns exist on public.users.
   * Only `true` is cached so a later migration is picked up without redeploying.
   */
  private async resolveStudentProfileColumnsFullyPresent(): Promise<boolean> {
    if (this.studentProfileColumnsFullyPresentCached === true) {
      return true;
    }
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name IN (
          'student_full_name',
          'degree',
          'faculty',
          'student_id',
          'is_profile_completed'
        )
      `,
    );
    const count = Number(result.rows[0]?.c ?? "0");
    if (count === 5) {
      this.studentProfileColumnsFullyPresentCached = true;
      return true;
    }
    return false;
  }

  private profileSelectFragment(include: boolean): string {
    if (include) {
      return `student_full_name,
        faculty,
        student_id,
        degree::text AS degree,
        is_profile_completed`;
    }
    return `NULL::text AS student_full_name,
        NULL::text AS faculty,
        NULL::text AS student_id,
        NULL::text AS degree,
        false AS is_profile_completed`;
  }

  private profileReturningFragment(include: boolean): string {
    if (include) {
      return ", student_full_name, faculty, student_id, degree::text AS degree, is_profile_completed";
    }
    return ", NULL::text AS student_full_name, NULL::text AS faculty, NULL::text AS student_id, NULL::text AS degree, false AS is_profile_completed";
  }

  private toBotUser(row: UserRow): BotUser {
    const deg = row.degree;
    return {
      id: row.id,
      role: parseUserRole(String(row.role)),
      telegramUsername: row.telegram_username,
      fullName: row.full_name,
      studentFullName: row.student_full_name,
      faculty: row.faculty,
      studentId: row.student_id,
      degree: deg === "bachelor" || deg === "master" ? deg : null,
      isProfileCompleted: Boolean(row.is_profile_completed),
    };
  }

  /** Keeps Supabase JWT app_metadata.role aligned with public.users.role after linking. */
  private async syncAuthAppMetadataRoleFromDb(userId: string, role: BotUser["role"]): Promise<void> {
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
    const displayName = (user.studentFullName ?? user.fullName ?? "Student").trim().slice(0, 80);
    const sid = (user.studentId ?? "pending").trim().slice(0, 32);
    const draftTitle = `Achievement request — ${sid} — ${displayName}`.slice(0, 200);
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

  async completeProfileFromBot(
    telegramId: string,
    input: {
      student_full_name: string;
      degree: "bachelor" | "master";
      faculty: string;
      student_id: string;
    },
  ): Promise<BotUser> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    if (user.role !== "student") {
      throw new BotApiHttpError(403, "Only students complete this profile.", "FORBIDDEN");
    }

    try {
      await this.usersRepository.updateProfile(user.id, {
        studentFullName: input.student_full_name.trim(),
        degree: input.degree,
        faculty: input.faculty.trim(),
        studentId: input.student_id.trim(),
      });
    } catch (error) {
      throw toBotApiError(error);
    }

    const refreshed = await this.findUserByTelegramId(telegramId);
    if (!refreshed) {
      throw new BotApiHttpError(500, "Could not reload profile after update.", "INTERNAL_SERVER_ERROR");
    }
    return refreshed;
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

    let includeProfile = await this.resolveStudentProfileColumnsFullyPresent();
    const selectSql = (profile: boolean) => `
      SELECT
        id,
        role::text AS role,
        full_name,
        telegram_id,
        ${telegramUsernameSelect},
        ${this.profileSelectFragment(profile)}
      FROM users
      WHERE telegram_id = $1::bigint
      LIMIT 1
    `;

    let result;
    try {
      result = await this.app.db.query<UserRow>(selectSql(includeProfile), [telegramId]);
    } catch (err) {
      if (isPgUndefinedColumnError(err)) {
        this.logProfileSchemaMismatch(err, "findUserByTelegramId.select");
        this.invalidateStudentProfileColumnCache();
        includeProfile = false;
        result = await this.app.db.query<UserRow>(selectSql(false), [telegramId]);
      } else {
        throw err;
      }
    }

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

  /**
   * Creates Supabase auth user + public.users row for a Telegram-only student (no email onboarding).
   * Synthetic email is unique per telegram_id; not used for bot UX.
   */
  private async createBotStudentUserForTelegram(
    telegramId: string,
    identity?: { telegramUsername: string | null; fullName: string | null },
  ): Promise<void> {
    const email = `tg.${telegramId}@telegram.bot.upms`;
    const password = randomBytes(32).toString("hex");
    const nextUsername = identity?.telegramUsername ? identity.telegramUsername.trim() : null;
    const nextFullName = identity?.fullName ? identity.fullName.trim() : null;

    const { data, error } = await this.app.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: nextFullName ? { full_name: nextFullName } : {},
      app_metadata: { role: "student" },
    });

    if (error || !data?.user?.id) {
      this.app.log.error({ err: error?.message, telegram_id: telegramId }, "createBotStudentUserForTelegram: auth.admin.createUser failed");
      throw new BotApiHttpError(
        502,
        "Could not register Telegram user with auth service.",
        "AUTH_USER_CREATE_FAILED",
      );
    }

    const userId = data.user.id;

    try {
      if (await this.hasTelegramUsernameColumn()) {
        await this.app.db.query(
          `
          INSERT INTO public.users (id, email, role, full_name, telegram_id, telegram_username)
          VALUES ($1::uuid, $2::citext, 'student'::public.user_role, $3, $4::bigint, $5)
          `,
          [userId, email, nextFullName, telegramId, nextUsername],
        );
      } else {
        await this.app.db.query(
          `
          INSERT INTO public.users (id, email, role, full_name, telegram_id)
          VALUES ($1::uuid, $2::citext, 'student'::public.user_role, $3, $4::bigint)
          `,
          [userId, email, nextFullName, telegramId],
        );
      }
    } catch (dbErr) {
      try {
        await this.app.supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (delErr) {
        this.app.log.warn({ err: delErr, userId }, "createBotStudentUserForTelegram: deleteUser after failed insert");
      }
      throw dbErr;
    }
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

    try {
      await this.createBotStudentUserForTelegram(telegramId, identity);
    } catch (err) {
      const raced = await this.findUserByTelegramId(telegramId, identity);
      if (raced) {
        this.app.log.info(
          { telegram_id: telegramId, user_id: raced.id, source: "existing_after_create_race" },
          "Resolved bot user mapping",
        );
        return raced;
      }
      throw err;
    }

    const created = await this.findUserByTelegramId(telegramId, identity);
    if (!created) {
      throw new BotApiHttpError(500, "User was created but could not be reloaded.", "INTERNAL_SERVER_ERROR");
    }

    this.app.log.info(
      { telegram_id: telegramId, user_id: created.id, source: "telegram_registered" },
      "Resolved bot user mapping",
    );
    return created;
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

      let includeProfile = await this.resolveStudentProfileColumnsFullyPresent();
      const runLink = async (profile: boolean) =>
        hasTelegramUsername
          ? this.app.db.query<UserRow>(
              `
            UPDATE users
            SET telegram_id = $2::bigint,
                telegram_username = COALESCE($3, telegram_username),
                full_name = COALESCE($4, full_name),
                updated_at = NOW()
            WHERE lower(email) = lower($1)
            RETURNING id, role::text AS role, full_name, telegram_id, telegram_username${this.profileReturningFragment(profile)}
            `,
              [email, telegramId, nextUsername, nextFullName],
            )
          : this.app.db.query<UserRow>(
              `
            UPDATE users
            SET telegram_id = $2::bigint,
                full_name = COALESCE($3, full_name),
                updated_at = NOW()
            WHERE lower(email) = lower($1)
            RETURNING id, role::text AS role, full_name, telegram_id, NULL::text AS telegram_username${this.profileReturningFragment(profile)}
            `,
              [email, telegramId, nextFullName],
            );

      let result;
      try {
        result = await runLink(includeProfile);
      } catch (err) {
        if (isPgUndefinedColumnError(err)) {
          this.logProfileSchemaMismatch(err, "linkTelegramByEmail.returning");
          this.invalidateStudentProfileColumnCache();
          includeProfile = false;
          result = await runLink(false);
        } else {
          throw err;
        }
      }

      const row = result.rows[0];
      if (!row) return null;

      await this.syncAuthAppMetadataRoleFromDb(row.id, parseUserRole(String(row.role)));

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

  async getUserSubmissions(telegramId: string): Promise<BotSubmissionListRow[]> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);

    let includeProfile = await this.resolveStudentProfileColumnsFullyPresent();

    const listSql = (profile: boolean) => `
      SELECT
        s.id,
        s.title,
        s.status::text AS status,
        s.total_score::text AS "totalPoints",
        s.created_at AS "createdAt",
        ${profile ? `u.student_full_name AS "studentFullName",
        u.faculty AS "faculty",
        u.student_id AS "studentId"` : `NULL::text AS "studentFullName",
        NULL::text AS "faculty",
        NULL::text AS "studentId"`}
      FROM submissions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT 10
    `;

    let result;
    try {
      result = await this.app.db.query<BotSubmissionListRow>(listSql(includeProfile), [user.id]);
    } catch (err) {
      if (isPgUndefinedColumnError(err)) {
        this.logProfileSchemaMismatch(err, "getUserSubmissions.select");
        this.invalidateStudentProfileColumnCache();
        includeProfile = false;
        result = await this.app.db.query<BotSubmissionListRow>(listSql(false), [user.id]);
      } else {
        throw err;
      }
    }

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
