import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, randomUUID } from "crypto";
import { env } from "../../config/env";
import type { AuthUser } from "../../types/auth-user";
import { ServiceError } from "../../utils/service-error";
import type { AuditLogRepository } from "../audit/audit-log.repository";
import type { NotificationService } from "../notifications/notification.service";
import { normalizeExternalLinkForPersistence } from "../submission-items/external-link-normalize";
import {
  WHOLE_CATEGORY_PLACEHOLDER_SLUG,
  type SubmissionItemEntity,
  type SubmissionItemsRepository,
} from "../submission-items/submission-items.repository";
import type { SubmissionItemsService } from "../submission-items/submission-items.service";
import {
  normalizeMetadata,
  resolveFixedPointsFromRules,
  resolveFixedProposedScore,
  roundScore2,
} from "../scoring/scoring-metadata";
import type { ScoringRulesRepository } from "../scoring/scoring-rules.repository";
import type { SubmissionsRepository } from "../submissions/submissions.repository";
import { MAX_ACTIVE_SUBMISSIONS_PER_USER } from "../submissions/submission-quota";
import type { SubmissionsService } from "../submissions/submissions.service";
import type { UsersRepository } from "../users/users.repository";
import { AntiFraudError, type AntiFraudService } from "../validation/anti-fraud.service";
import { getPostgresDriverErrorFields } from "../../utils/pg-http-map";
import { BotApiHttpError } from "./bot-api-errors";
import {
  assertValidProofReference,
  normalizeProofReferenceForDb,
} from "../files/proof-reference";

function parseUserRole(value: string): "student" | "reviewer" | "admin" {
  if (value === "superadmin") {
    return "admin";
  }
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

/** Bot list row: submission envelope + first line item (no user identity). */
export interface BotSubmissionListRow {
  id: string;
  /** Headline: first item title, else submission `title`. */
  title: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  link: string | null;
  hasFile: boolean;
  status: string;
  totalPoints: string;
  createdAt: string;
}

/** Post-submit payload for Telegram bot (business fields only in `items`). */
export interface BotSubmitDraftItemSummary {
  title: string;
  category: string;
  subcategory: string;
  description: string;
  link: string | null;
  hasFile: boolean;
}

export interface BotSubmitDraftResult {
  submissionId: string;
  items: BotSubmitDraftItemSummary[];
}

export interface BotCompleteSubmissionItemInput {
  categoryId: string;
  subcategory: string | null;
  title: string;
  description: string;
  proofFileUrl: string;
  externalLink?: string | null;
  metadata?: Record<string, string | number | boolean>;
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

/** GET /api/bot/categories — stable contract for Telegram clients. */
export interface BotCategoryCatalogSub {
  slug: string;
  label: string;
  /** Human label for buttons (same as label; no slug in UI). */
  title: string;
  minScore: number;
  maxScore: number;
  scoringMode: string;
  defaultPoints: number | null;
}

export interface BotCategoryCatalogEntry {
  id: string;
  code: string;
  title: string;
  name: string;
  description: string | null;
  type: string;
  minScore: number;
  maxScore: number;
  hasSubcategories: boolean;
  subcategories: BotCategoryCatalogSub[];
}

const TEN_MB = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

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

function isPostgresUndefinedColumnError(error: unknown): boolean {
  return getPostgresDriverErrorFields(error)?.code === "42703";
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
    private readonly submissionsRepository: SubmissionsRepository,
    private readonly submissionItemsRepository: SubmissionItemsRepository,
    private readonly scoringRulesRepository: ScoringRulesRepository,
    private readonly notifications: NotificationService,
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

  async getCategoriesCatalog(): Promise<BotCategoryCatalogEntry[]> {
    const sqlFull = `
        SELECT
          c.id,
          COALESCE(NULLIF(BTRIM(c.code), ''), c.name) AS code,
          COALESCE(NULLIF(BTRIM(c.title), ''), c.name) AS title,
          c.name,
          c.description,
          c.type::text AS type,
          c.min_score,
          c.max_score,
          cs.slug,
          cs.label,
          cs.sort_order,
          cs.min_points::text AS sub_min,
          cs.max_points::text AS sub_max,
          cs.scoring_mode::text AS scoring_mode,
          cs.default_points::text AS sub_default
        FROM categories c
        LEFT JOIN category_subcategories cs ON cs.category_id = c.id
          AND cs.slug IS DISTINCT FROM 'general'
          AND cs.slug IS DISTINCT FROM '${WHOLE_CATEGORY_PLACEHOLDER_SLUG}'
        WHERE c.name IS DISTINCT FROM 'legacy_uncategorized'
        ORDER BY c.name ASC, cs.sort_order ASC NULLS LAST, cs.slug ASC NULLS LAST
        `;

    const sqlLegacy = `
        SELECT
          c.id,
          c.name AS code,
          c.name AS title,
          c.name,
          c.description,
          c.type::text AS type,
          c.min_score,
          c.max_score,
          cs.slug,
          cs.label,
          cs.sort_order,
          cs.min_points::text AS sub_min,
          cs.max_points::text AS sub_max,
          cs.scoring_mode::text AS scoring_mode,
          cs.default_points::text AS sub_default
        FROM categories c
        LEFT JOIN category_subcategories cs ON cs.category_id = c.id
          AND cs.slug IS DISTINCT FROM 'general'
          AND cs.slug IS DISTINCT FROM '${WHOLE_CATEGORY_PLACEHOLDER_SLUG}'
        WHERE c.name IS DISTINCT FROM 'legacy_uncategorized'
        ORDER BY c.name ASC, cs.sort_order ASC NULLS LAST, cs.slug ASC NULLS LAST
        `;

    type Row = {
      id: string;
      code: string | null;
      title: string | null;
      name: string;
      description: string | null;
      type: string;
      min_score: string;
      max_score: string;
      slug: string | null;
      label: string | null;
      sort_order: number | null;
      sub_min: string | null;
      sub_max: string | null;
      scoring_mode: string | null;
      sub_default: string | null;
    };

    let rows: Row[];
    try {
      const result = await this.app.db.query<Row>(sqlFull);
      rows = result.rows;
    } catch (error) {
      if (isMissingRelationError(error)) {
        this.app.log.warn("categories tables are not available yet; returning empty catalog");
        return [];
      }
      if (isPostgresUndefinedColumnError(error)) {
        this.app.log.warn(
          { err: error },
          "getCategoriesCatalog: categories.code/title missing; using legacy projection",
        );
        const result = await this.app.db.query<Row>(sqlLegacy);
        rows = result.rows;
      } else {
        throw error;
      }
    }

    return this.aggregateCatalogRows(rows);
  }

  private aggregateCatalogRows(
    rows: Array<{
      id: string;
      code: string | null;
      title: string | null;
      name: string;
      description: string | null;
      type: string;
      min_score: string;
      max_score: string;
      slug: string | null;
      label: string | null;
      sort_order: number | null;
      sub_min: string | null;
      sub_max: string | null;
      scoring_mode: string | null;
      sub_default: string | null;
    }>,
  ): BotCategoryCatalogEntry[] {
    const byId = new Map<
      string,
      {
        id: string;
        code: string;
        title: string;
        name: string;
        description: string | null;
        type: string;
        minScore: number;
        maxScore: number;
        subcategories: BotCategoryCatalogSub[];
      }
    >();

    for (const row of rows) {
      let entry = byId.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          code: row.code ?? row.name,
          title: row.title ?? row.name,
          name: row.name,
          description: row.description,
          type: row.type,
          minScore: Number(row.min_score),
          maxScore: Number(row.max_score),
          subcategories: [],
        };
        byId.set(row.id, entry);
      }
      if (row.slug && row.label) {
        const subMin = row.sub_min !== null && row.sub_min !== "" ? Number(row.sub_min) : entry.minScore;
        const subMax = row.sub_max !== null && row.sub_max !== "" ? Number(row.sub_max) : entry.maxScore;
        const subDefault =
          row.sub_default !== null && row.sub_default !== "" ? Number(row.sub_default) : null;
        const label = row.label;
        entry.subcategories.push({
          slug: row.slug,
          label,
          title: label,
          minScore: subMin,
          maxScore: subMax,
          scoringMode: row.scoring_mode ?? row.type,
          defaultPoints: Number.isFinite(subDefault) ? subDefault : null,
        });
      }
    }

    return [...byId.values()].map((e) => ({
      id: e.id,
      code: e.code,
      title: e.title,
      name: e.name,
      description: e.description,
      type: e.type,
      minScore: e.minScore,
      maxScore: e.maxScore,
      hasSubcategories: e.subcategories.length > 0,
      subcategories: e.subcategories,
    }));
  }

  /** Draft submission for Telegram multi-item flow (POST /api/submissions equivalent). */
  async createDraftSubmissionForBot(telegramId: string, title: string): Promise<{ submissionId: string }> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    const trimmed = title.trim();
    if (!trimmed) {
      throw new BotApiHttpError(400, "Title is required.", "VALIDATION_ERROR");
    }
    try {
      const created = await this.submissions.createSubmission(toAuthUser(user), {
        title: trimmed.slice(0, 200),
        description: undefined,
      });
      return { submissionId: created.id };
    } catch (error) {
      throw toBotApiError(error);
    }
  }

  private mapItemToBotSubmitSummary(item: SubmissionItemEntity): BotSubmitDraftItemSummary {
    const link =
      item.externalLink && item.externalLink.trim() !== "" ? item.externalLink.trim() : null;
    const isPlaceholder = item.subcategory === WHOLE_CATEGORY_PLACEHOLDER_SLUG;
    const sub = isPlaceholder
      ? "—"
      : (item.subcategoryLabel ?? item.subcategory ?? "").trim() || "—";
    return {
      title: item.title,
      category: item.category,
      subcategory: sub,
      description: (item.description ?? "").trim() || "—",
      link,
      hasFile: Boolean(item.proofFileUrl && item.proofFileUrl.trim() !== ""),
    };
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
    try {
      const user = await this.findOrCreateUserByTelegramId(telegramId);
      if (user.role !== "student") {
        throw new BotApiHttpError(403, "Only students complete this profile.", "FORBIDDEN");
      }

      await this.usersRepository.updateProfile(user.id, {
        studentFullName: input.student_full_name.trim(),
        degree: input.degree,
        faculty: input.faculty.trim(),
        studentId: input.student_id.trim(),
      });

      const refreshed = await this.findUserByTelegramId(telegramId);
      if (!refreshed) {
        throw new BotApiHttpError(500, "Could not reload profile after update.", "INTERNAL_SERVER_ERROR");
      }
      return refreshed;
    } catch (error) {
      if (error instanceof BotApiHttpError) {
        throw error;
      }

      const pg = getPostgresDriverErrorFields(error);
      if (pg?.code === "42703") {
        this.app.log.error(
          { code: pg.code, message: pg.message ?? String(error), context: "profile_complete" },
          "profile_complete: postgres undefined_column",
        );
        throw new BotApiHttpError(
          503,
          "System is updating. Please try again in a moment.",
          "SCHEMA_NOT_READY",
        );
      }
      if (pg?.code === "23505") {
        this.app.log.error(
          {
            code: pg.code,
            message: pg.message ?? String(error),
            context: "profile_complete",
            constraint: pg.constraint,
          },
          "profile_complete: postgres unique_violation",
        );
        throw new BotApiHttpError(409, "Student ID already exists.", "DUPLICATE_STUDENT_ID");
      }

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
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{ itemId: string }> {
    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const slug = await this.resolveBotSubcategorySlug(input.categoryId, input.subcategory);
    let ext: string | null;
    try {
      ext = normalizeExternalLinkForPersistence(input.externalLink);
    } catch (e) {
      throw toBotApiError(e);
    }

    try {
      const item = await this.submissionItems.addItem(toAuthUser(user), input.submissionId, {
        category_id: input.categoryId,
        ...(slug ? { subcategory: slug } : {}),
        title: input.title,
        description: input.description,
        proof_file_url: input.proofFileUrl,
        external_link: ext ?? undefined,
        metadata: normalizeMetadata(input.metadata ?? {}) as Record<string, string | number | boolean>,
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
  async submitDraftFromBot(telegramId: string, submissionId: string): Promise<BotSubmitDraftResult> {
    const user = await this.findOrCreateUserByTelegramId(telegramId);
    const auth = toAuthUser(user);
    try {
      await this.submissions.submitSubmission(auth, submissionId);
      const items = await this.submissionItems.listItems(auth, submissionId);
      this.app.log.info(
        { telegram_id: telegramId, user_id: user.id, submission_id: submissionId },
        "Bot submitted draft submission",
      );
      return {
        submissionId,
        items: items.map((it) => this.mapItemToBotSubmitSummary(it)),
      };
    } catch (error) {
      throw toBotApiError(error);
    }
  }

  /**
   * Single transaction: create submission, insert all lines with optional proposed scores, submit.
   * Used by Telegram bot — no draft rows until the user confirms.
   */
  async completeSubmissionFromBot(
    telegramId: string,
    input: { items: BotCompleteSubmissionItemInput[] },
  ): Promise<BotSubmitDraftResult> {
    if (input.items.length === 0) {
      throw new BotApiHttpError(400, "At least one submission line is required.", "VALIDATION_ERROR");
    }

    const user = await this.findOrCreateUserByTelegramId(telegramId);
    if (user.role !== "student") {
      throw new BotApiHttpError(403, "Only students can submit achievements via the bot.", "FORBIDDEN");
    }

    const auth = toAuthUser(user);
    await this.usersRepository.assertStudentProfileCompleteForSubmission(user.id);

    const active = await this.submissionsRepository.countActiveSubmissionsForUser(user.id);
    if (active >= MAX_ACTIVE_SUBMISSIONS_PER_USER) {
      throw new BotApiHttpError(
        409,
        `You can have at most ${MAX_ACTIVE_SUBMISSIONS_PER_USER} active submissions (draft, submitted, in review, or awaiting revision).`,
        "QUOTA_EXCEEDED",
      );
    }

    await this.antiFraud.assertNoDuplicateSubmission({
      userId: user.id,
      title: input.items[0]!.title.trim(),
      description: undefined,
    });

    type PreparedRow = {
      categoryId: string;
      subcategoryId: string | null;
      title: string;
      description: string;
      proofFileUrl: string;
      externalLink: string | null;
      metadata: Record<string, unknown>;
      proposedScore: number | null;
    };

    const prepared: PreparedRow[] = [];

    for (const it of input.items) {
      let proofPath: string;
      try {
        assertValidProofReference(it.proofFileUrl);
        proofPath = normalizeProofReferenceForDb(it.proofFileUrl, user.id);
      } catch (e) {
        throw new BotApiHttpError(
          400,
          e instanceof Error ? e.message : "Invalid proof file reference",
          "VALIDATION_ERROR",
        );
      }
      const slug = await this.resolveBotSubcategorySlug(it.categoryId, it.subcategory);
      let subcategoryId: string | null = null;
      if (slug) {
        subcategoryId = await this.submissionItemsRepository.findSubcategoryIdBySlug(it.categoryId, slug);
        if (!subcategoryId) {
          throw new BotApiHttpError(400, "Unknown subcategory slug for this category.", "VALIDATION_ERROR");
        }
      } else {
        const hasSubs = await this.submissionItemsRepository.categoryHasSubcategories(it.categoryId);
        if (hasSubs) {
          throw new BotApiHttpError(400, "Subcategory is required for this category.", "VALIDATION_ERROR");
        }
        await this.submissionItemsRepository.ensureWholeCategoryPlaceholderForCategory(it.categoryId);
        subcategoryId = await this.submissionItemsRepository.findSubcategoryIdBySlug(
          it.categoryId,
          WHOLE_CATEGORY_PLACEHOLDER_SLUG,
        );
        if (!subcategoryId) {
          throw new BotApiHttpError(
            400,
            "Unknown category_id — cannot attach a submission line to this category.",
            "VALIDATION_ERROR",
          );
        }
      }

      const metadata = normalizeMetadata(it.metadata ?? {}) as Record<string, unknown>;
      const categoryName = await this.submissionItemsRepository.resolveCategoryName(it.categoryId);
      if (!categoryName) {
        throw new BotApiHttpError(400, "Unknown category.", "VALIDATION_ERROR");
      }
      if (categoryName === "olympiads" && subcategoryId) {
        const subSlug = await this.submissionItemsRepository.findSubcategorySlugById(subcategoryId);
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
            throw new BotApiHttpError(
              400,
              "Olympiad items require metadata.place of 1, 2, or 3",
              "VALIDATION_ERROR",
            );
          }
        }
      }

      let externalLink: string | null;
      try {
        externalLink = normalizeExternalLinkForPersistence(it.externalLink);
      } catch (e) {
        throw toBotApiError(e);
      }

      const proposedScore = await this.computeProposedScoreAtInsert({
        categoryId: it.categoryId,
        subcategoryId,
        metadata,
      });

      prepared.push({
        categoryId: it.categoryId,
        subcategoryId,
        title: it.title.trim(),
        description: it.description.trim(),
        proofFileUrl: proofPath,
        externalLink,
        metadata,
        proposedScore,
      });
    }

    const submissionTitle = prepared[0]!.title.slice(0, 200);

    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const created = await this.submissionsRepository.create(
        {
          userId: user.id,
          title: submissionTitle,
          description: undefined,
        },
        client,
      );

      for (const row of prepared) {
        await this.submissionItemsRepository.createItem(
          {
            submissionId: created.id,
            categoryId: row.categoryId,
            subcategoryId: row.subcategoryId,
            title: row.title,
            description: row.description,
            proofFileUrl: row.proofFileUrl,
            externalLink: row.externalLink,
            proposedScore: row.proposedScore,
            metadata: row.metadata,
          },
          client,
        );
      }

      await this.submissionsRepository.updateStatus(
        {
          id: created.id,
          status: "submitted",
          submittedAt: true,
        },
        client,
      );

      await client.query("COMMIT");

      await this.audit.insert({
        actorUserId: user.id,
        targetUserId: user.id,
        entityTable: "submissions",
        entityId: created.id,
        action: "submission_submitted",
        newValues: { status: "submitted", lines: prepared.length },
      });

      this.notifications.notifySubmissionSubmitted({
        userId: user.id,
        submissionId: created.id,
        title: submissionTitle,
      });

      const items = await this.submissionItems.listItems(auth, created.id);
      this.app.log.info(
        { telegram_id: telegramId, user_id: user.id, submission_id: created.id, lines: prepared.length },
        "Bot atomic submission complete",
      );

      return {
        submissionId: created.id,
        items: items.map((i) => this.mapItemToBotSubmitSummary(i)),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw toBotApiError(error);
    } finally {
      client.release();
    }
  }

  private async computeProposedScoreAtInsert(input: {
    categoryId: string;
    subcategoryId: string | null;
    metadata: Record<string, unknown>;
  }): Promise<number | null> {
    const typeRaw = await this.submissionItemsRepository.findCategoryScoringType(input.categoryId);
    const type = (typeRaw ?? "").toLowerCase();
    if (type === "manual" || type === "expert" || type === "range") {
      return null;
    }
    if (type !== "fixed") {
      return null;
    }

    const bounds = await this.submissionItemsRepository.findCategoryBounds(input.categoryId);
    if (!bounds || !input.subcategoryId) {
      return null;
    }

    const rules = await this.scoringRulesRepository.findRulesBySubcategoryId(input.subcategoryId);
    if (rules.length > 0) {
      const matched = resolveFixedPointsFromRules(input.metadata, rules);
      if (matched !== null) {
        return roundScore2(matched);
      }
      return null;
    }

    const categoryScoring = await this.scoringRulesRepository.findCategoryScoringBand(
      input.categoryId,
      input.subcategoryId,
    );
    const fallback = resolveFixedProposedScore({
      metadata: input.metadata,
      scoringRules: [],
      categoryScoring,
      bounds,
    });
    return roundScore2(fallback);
  }

  private async resolveBotSubcategorySlug(
    categoryId: string,
    subcategory: string | null,
  ): Promise<string | null> {
    const hasSubs = await this.submissionItems.categoryHasSubcategories(categoryId);
    if (!hasSubs) {
      return null;
    }

    const slug = subcategory?.trim() ?? "";
    if (!slug) {
      throw new BotApiHttpError(400, "Subcategory is required for this category", "VALIDATION_ERROR");
    }

    return slug;
  }

  async createStudentSubmissionFromBot(input: {
    telegramId: string;
    categoryId: string;
    subcategory?: string | null;
    title: string;
    description: string;
    proofFileUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ submissionId: string }> {
    const user = await this.findOrCreateUserByTelegramId(input.telegramId);
    const auth = toAuthUser(user);
    const slug = await this.resolveBotSubcategorySlug(input.categoryId, input.subcategory ?? null);

    try {
      const created = await this.submissions.createSubmission(auth, {
        title: input.title,
        description: input.description,
      });

      await this.submissionItems.addItem(auth, created.id, {
        category_id: input.categoryId,
        ...(slug ? { subcategory: slug } : {}),
        title: input.title,
        description: input.description,
        proof_file_url: input.proofFileUrl,
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
        WHERE name = 'internal_competitions'
        LIMIT 1
        `,
      );
    }
    const categoryRow = catRes.rows[0];
    if (!categoryRow) {
      throw new BotApiHttpError(400, "Unknown category for achievement", "VALIDATION_ERROR");
    }

    const genSub = await this.app.db.query<{ id: string; slug: string }>(
      `
      SELECT id, slug
      FROM category_subcategories
      WHERE category_id = $1
        AND slug IS DISTINCT FROM 'general'
      ORDER BY sort_order ASC NULLS LAST, slug ASC
      LIMIT 1
      `,
      [categoryRow.id],
    );
    const defaultSubSlug = genSub.rows[0]?.slug;

    try {
      const created = await this.submissions.createSubmission(auth, {
        title: `Achievement: ${input.category}`,
        description: input.details,
      });

      await this.submissionItems.addItem(auth, created.id, {
        category_id: categoryRow.id,
        ...(defaultSubSlug ? { subcategory: defaultSubSlug } : {}),
        title: `Achievement: ${input.category}`,
        description: input.details,
        proof_file_url: input.proofFileUrl,
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

    const result = await this.app.db.query<BotSubmissionListRow>(
      `
      SELECT
        s.id,
        COALESCE(
          NULLIF(BTRIM(fi.item_title), ''),
          NULLIF(BTRIM(s.title), ''),
          '—'
        ) AS title,
        fi.category_name AS category,
        COALESCE(
          NULLIF(BTRIM(fi.subcategory_label), ''),
          NULLIF(BTRIM(fi.subcategory_slug), '')
        ) AS subcategory,
        fi.item_description AS description,
        CASE
          WHEN fi.external_link IS NOT NULL AND BTRIM(fi.external_link) <> '' THEN BTRIM(fi.external_link)
          ELSE NULL
        END AS link,
        COALESCE(fi.has_file, false) AS "hasFile",
        s.status::text AS status,
        s.total_score::text AS "totalPoints",
        s.created_at AS "createdAt"
      FROM submissions s
      LEFT JOIN LATERAL (
        SELECT
          si.title AS item_title,
          c.name AS category_name,
          cs.label AS subcategory_label,
          cs.slug AS subcategory_slug,
          si.description AS item_description,
          si.external_link,
          (si.proof_file_url IS NOT NULL AND BTRIM(si.proof_file_url) <> '') AS has_file
        FROM submission_items si
        LEFT JOIN categories c ON c.id = si.category_id
        LEFT JOIN category_subcategories cs ON cs.id = si.subcategory_id
        WHERE si.submission_id = s.id
        ORDER BY si.created_at ASC, si.id ASC
        LIMIT 1
      ) fi ON true
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
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
    const storagePath = `${user.id}/${randomUUID()}-${safeFilename}`;

    const uploadResult = await this.app.supabaseAdmin.storage.from(env.STORAGE_BUCKET).upload(storagePath, input.bytes, {
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

    const { data: publicUrlData } = this.app.supabaseAdmin.storage.from(env.STORAGE_BUCKET).getPublicUrl(storagePath);
    const proofFileUrl = publicUrlData.publicUrl;

    this.app.log.info(
      {
        telegram_id: input.telegramId,
        user_id: user.id,
        size_bytes: input.bytes.byteLength,
        mime_type: input.mimeType,
        checksum_sha256: checksum,
        storage_path: storagePath,
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
