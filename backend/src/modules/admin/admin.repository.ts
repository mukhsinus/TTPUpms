import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getPostgresDriverErrorFields } from "../../utils/pg-http-map";
import { getSubmissionsSemesterColumnPresent } from "../../utils/submissions-semester-schema";
import { getUsersPhoneColumnPresent } from "../../utils/users-phone-column";
import { isLikelyStudentId, normalizeStudentId } from "../../utils/student-id";
import { ServiceError } from "../../utils/service-error";
import type {
  AdminModerationStatus,
  AdminStudentsQuery,
  AdminSubmissionsQuery,
  AdminUpdateStudentBody,
} from "./admin.schema";

/** Resolved from admin UI scope: null = all semesters. */
export type AdminSemesterDb = "first" | "second" | null;

export interface AdminSubmissionListRow {
  id: string;
  user_id: string;
  student_id: string | null;
  title: string;
  db_status: string;
  semester: string | null;
  created_at: string;
  submitted_at: string;
  score: string | null;
  category_code: string | null;
  category_title: string | null;
  owner_name: string | null;
}

export interface AdminSubmissionGroupListRow {
  group_key: string;
  submissions_count: string;
  latest_submission_id: string;
  user_id: string;
  student_id: string | null;
  title: string;
  db_status: string;
  semester: string | null;
  created_at: string;
  submitted_at: string;
  score: string | null;
  category_code: string | null;
  category_title: string | null;
  owner_name: string | null;
}

export interface AdminSubmissionDetailRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  db_status: string;
  total_score: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminUserRow {
  student_full_name: string | null;
  faculty: string | null;
  student_id: string | null;
  telegram_username: string | null;
  phone: string | null;
}

export interface AdminItemRow {
  id: string;
  submission_id: string;
  submission_user_id: string;
  title: string;
  description: string | null;
  proof_file_url: string | null;
  external_link: string | null;
  proposed_score: string | null;
  approved_score: string | null;
  reviewer_comment: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  category_type: string | null;
  category_code: string | null;
  category_name: string | null;
  category_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminFileRow {
  id: string;
  submission_id: string | null;
  submission_item_id: string | null;
  bucket: string;
  storage_path: string;
  file_url: string | null;
  original_filename: string;
  mime_type: string | null;
  created_at: string;
}

export interface AdminMetricsRow {
  pending_count: string;
  approved_today: string;
  rejected_today: string;
  total_processed: string;
}

export interface AdminDashboardSummaryRow {
  pending_count: string;
  avg_review_time_hours: string | null;
  oldest_pending_hours: string | null;
  processed_7d: string;
}

export interface AdminNeedsAttentionRow {
  submission_id: string;
  submission_title: string;
  student_id: string | null;
  student_name: string | null;
  waiting_hours: string;
  missing_proof_file: boolean;
  needs_manual_score: boolean;
}

export interface AdminActivityRow {
  activity_id: string;
  admin_id: string;
  admin_name: string;
  admin_email: string | null;
  student_id: string | null;
  student_name: string | null;
  submission_id: string | null;
  submission_title: string | null;
  submission_submitted_at: string | null;
  action: string;
  created_at: string;
}

export interface AdminActivitySummaryRow {
  total_actions: string;
  approvals: string;
  rejects: string;
}

export type AdminSearchSuggestionKind =
  | "student_id"
  | "title";

export interface AdminSearchSuggestionRow {
  kind: AdminSearchSuggestionKind;
  value: string;
  label: string;
  meta: string | null;
}

export interface AdminStudentOverviewRow {
  user_id: string;
  student_id: string;
  student_name: string | null;
  faculty: string | null;
  telegram_username: string | null;
  total_submissions: string;
  pending_submissions: string;
  approved_submissions: string;
  rejected_submissions: string;
  total_approved_score: string;
}

export interface AdminStudentListRow {
  id: string;
  full_name: string | null;
  student_full_name: string | null;
  telegram_username: string | null;
  telegram_id: string | null;
  phone: string | null;
  degree: string | null;
  faculty: string | null;
  student_id: string | null;
  registration_date: string;
  last_activity_at: string;
  total_achievements_submitted: string;
  total_approved_score: string;
}

export interface AdminStudentDetailRow {
  id: string;
  full_name: string | null;
  student_full_name: string | null;
  telegram_username: string | null;
  telegram_id: string | null;
  phone: string | null;
  degree: string | null;
  faculty: string | null;
  student_id: string | null;
  email: string | null;
  is_profile_completed: boolean;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  total_achievements_submitted: string;
  total_submissions: string;
  total_approved_score: string;
}

export type AdminDbExecutor = FastifyInstance["db"] | PoolClient;

function isPgUndefinedColumnError(error: unknown): boolean {
  return getPostgresDriverErrorFields(error)?.code === "42703";
}

function moderationStatusFilterSql(status: AdminModerationStatus): { clause: string; params: unknown[] } {
  if (status === "pending") {
    return {
      clause: `s.status IN ('submitted', 'review', 'needs_revision')`,
      params: [],
    };
  }
  if (status === "approved") {
    return { clause: `s.status = 'approved'`, params: [] };
  }
  return { clause: `s.status = 'rejected'`, params: [] };
}

const SUBMISSION_ID_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminStudentSubmissionsSemesterWhereSql(semesterDb: AdminSemesterDb): string {
  if (semesterDb === null) {
    return "";
  }
  return semesterDb === "first" ? " AND s.semester = 'first' " : " AND s.semester = 'second' ";
}

function adminStudentOverviewJoinOnSql(semesterDb: AdminSemesterDb): string {
  if (semesterDb === null) {
    return "s.user_id = u.id";
  }
  return semesterDb === "first"
    ? "s.user_id = u.id AND s.semester = 'first'"
    : "s.user_id = u.id AND s.semester = 'second'";
}

/**
 * Shared WHERE builder for admin submission list + count (`u` join required for search).
 */
function buildAdminSubmissionFilters(
  query: AdminSubmissionsQuery,
  semesterDb: AdminSemesterDb,
): { whereSql: string; params: unknown[] } {
  const conditions: string[] = ["s.status <> 'draft'"];
  const params: unknown[] = [];
  let p = 1;

  if (query.status) {
    const f = moderationStatusFilterSql(query.status);
    conditions.push(f.clause);
    params.push(...f.params);
  }
  if (query.category || query.categoryKey) {
    const categoryTerms: string[] = [];
    const pushTerm = (value: string | undefined): void => {
      const term = value?.trim();
      if (!term) {
        return;
      }
      if (categoryTerms.some((entry) => entry.toLowerCase() === term.toLowerCase())) {
        return;
      }
      categoryTerms.push(term);
    };
    pushTerm(query.category);
    pushTerm(query.categoryKey);

    const termClauses: string[] = [];
    for (const term of categoryTerms) {
      termClauses.push(`
        c2.code = $${p}
        OR lower(c2.name) = lower($${p})
        OR lower(COALESCE(c2.title, '')) = lower($${p})
        OR lower(regexp_replace(c2.name, '[_-]+', ' ', 'g')) = lower($${p})
        OR lower(c2.name) = lower(regexp_replace($${p}, '\\s+', '_', 'g'))
      `);
      params.push(term);
      p += 1;
    }
    conditions.push(`
      EXISTS (
        SELECT 1 FROM public.submission_items si2
        INNER JOIN public.categories c2 ON c2.id = si2.category_id
        WHERE si2.submission_id = s.id
          AND (
            ${termClauses.map((clause) => `(${clause})`).join(" OR ")}
          )
      )
    `);
  }
  if (query.dateFrom) {
    conditions.push(`COALESCE(s.submitted_at, s.created_at) >= $${p}::timestamptz`);
    params.push(query.dateFrom);
    p += 1;
  }
  if (query.dateTo) {
    conditions.push(`COALESCE(s.submitted_at, s.created_at) <= $${p}::timestamptz`);
    params.push(query.dateTo);
    p += 1;
  }
  if (query.search?.trim()) {
    const raw = query.search.trim().slice(0, 200);
    const normalizedStudentId = normalizeStudentId(raw);
    if (SUBMISSION_ID_UUID.test(raw)) {
      conditions.push(`s.id = $${p}::uuid`);
      params.push(raw);
      p += 1;
    } else if (isLikelyStudentId(raw)) {
      conditions.push(`upper(regexp_replace(COALESCE(u.student_id::text, ''), '\\s+', '', 'g')) = $${p}`);
      params.push(normalizedStudentId);
      p += 1;
    } else {
      const escaped = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      conditions.push(
        `(
          s.title ILIKE $${p} ESCAPE '\\'
          OR COALESCE(s.description, '') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(u.student_full_name::text, u.full_name::text, '') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(u.student_id::text, '') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(u.faculty::text, '') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(u.telegram_username::text, '') ILIKE $${p} ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM public.submission_items si3
            LEFT JOIN public.categories c3 ON c3.id = si3.category_id
            WHERE si3.submission_id = s.id
              AND (
                COALESCE(c3.title::text, c3.name, '') ILIKE $${p} ESCAPE '\\'
                OR COALESCE(si3.metadata->>'teacher', si3.metadata->>'teacher_name', si3.metadata->>'supervisor', '') ILIKE $${p} ESCAPE '\\'
              )
          )
        )`,
      );
      params.push(pattern);
      p += 1;
    }
  }

  if (semesterDb !== null) {
    conditions.push(`s.semester = $${p}`);
    params.push(semesterDb);
  }

  return { whereSql: `WHERE ${conditions.join(" AND ")}`, params };
}

function buildAdminStudentsFilters(query: AdminStudentsQuery): { whereSql: string; params: unknown[] } {
  const params: unknown[] = [];
  const conditions: string[] = ["u.role::text = 'student'", "u.telegram_id IS NOT NULL"];
  let p = 1;

  if (query.search?.trim()) {
    const raw = query.search.trim().slice(0, 200);
    const escaped = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;
    const normalized = normalizeStudentId(raw);
    conditions.push(
      `(
        COALESCE(u.student_full_name::text, u.full_name::text, '') ILIKE $${p} ESCAPE '\\'
        OR COALESCE(u.student_id::text, '') ILIKE $${p} ESCAPE '\\'
        OR COALESCE(u.telegram_username::text, '') ILIKE $${p} ESCAPE '\\'
        OR upper(regexp_replace(COALESCE(u.student_id::text, ''), '\\s+', '', 'g')) = $${p + 1}
      )`,
    );
    params.push(pattern, normalized);
    p += 2;
  }

  if (query.faculty?.trim()) {
    conditions.push(`COALESCE(u.faculty::text, '') ILIKE $${p} ESCAPE '\\'`);
    params.push(`%${query.faculty.trim().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
    p += 1;
  }

  if (query.degree) {
    conditions.push(`u.degree::text = $${p}`);
    params.push(query.degree);
    p += 1;
  }

  return { whereSql: `WHERE ${conditions.join(" AND ")}`, params };
}

function buildStudentIdentityGroupRawSql(userAlias = "u"): string {
  const phoneNormalized = `regexp_replace(COALESCE(to_jsonb(${userAlias})->>'phone', ''), '\\D+', '', 'g')`;
  const nameNormalized = `lower(regexp_replace(COALESCE(NULLIF(BTRIM(${userAlias}.student_full_name), ''), NULLIF(BTRIM(${userAlias}.full_name), ''), ''), '\\s+', ' ', 'g'))`;
  const facultyNormalized = `lower(regexp_replace(COALESCE(BTRIM(${userAlias}.faculty), ''), '\\s+', ' ', 'g'))`;
  const studentIdNormalized = `upper(regexp_replace(COALESCE(${userAlias}.student_id, ''), '\\s+', '', 'g'))`;
  return `
    CASE
      WHEN ${phoneNormalized} = ''
        AND ${nameNormalized} = ''
        AND ${facultyNormalized} = ''
        AND ${studentIdNormalized} = ''
      THEN 'uid:' || ${userAlias}.id::text
      ELSE concat_ws('|', ${phoneNormalized}, ${nameNormalized}, ${facultyNormalized}, ${studentIdNormalized})
    END
  `;
}

function buildStudentIdentityGroupHashSql(userAlias = "u"): string {
  return `md5(${buildStudentIdentityGroupRawSql(userAlias)})`;
}

export class AdminRepository {
  constructor(private readonly app: FastifyInstance) {}

  async getDashboardSummary(): Promise<AdminDashboardSummaryRow> {
    const result = await this.app.db.query<AdminDashboardSummaryRow>(
      `
      WITH pending AS (
        SELECT s.created_at
        FROM public.submissions s
        WHERE s.status IN ('submitted', 'review', 'needs_revision')
      )
      SELECT
        (SELECT COUNT(*)::text FROM pending) AS pending_count,
        (
          SELECT ROUND(AVG(EXTRACT(EPOCH FROM (s.reviewed_at - s.created_at)) / 3600.0)::numeric, 2)::text
          FROM public.submissions s
          WHERE s.status IN ('approved', 'rejected')
            AND s.reviewed_at IS NOT NULL
        ) AS avg_review_time_hours,
        (
          SELECT ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0)::numeric, 2)::text
          FROM pending p
        ) AS oldest_pending_hours,
        (
          SELECT COUNT(*)::text
          FROM public.submissions s
          WHERE s.status IN ('approved', 'rejected')
            AND s.reviewed_at >= NOW() - INTERVAL '7 days'
        ) AS processed_7d
      `,
    );

    return (
      result.rows[0] ?? {
        pending_count: "0",
        avg_review_time_hours: "0",
        oldest_pending_hours: "0",
        processed_7d: "0",
      }
    );
  }

  async listNeedsAttention(limit = 5): Promise<AdminNeedsAttentionRow[]> {
    const result = await this.app.db.query<AdminNeedsAttentionRow>(
      `
      WITH pending AS (
        SELECT
          s.id,
          s.title,
          s.user_id,
          s.created_at,
          ROUND(EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600.0, 2)::text AS waiting_hours,
          EXISTS (
            SELECT 1
            FROM public.submission_items si
            WHERE si.submission_id = s.id
              AND (si.proof_file_url IS NULL OR BTRIM(si.proof_file_url) = '')
          ) AS missing_proof_file,
          EXISTS (
            SELECT 1
            FROM public.submission_items si
            LEFT JOIN public.categories c ON c.id = si.category_id
            WHERE si.submission_id = s.id
              AND (
                c.type::text IN ('manual', 'expert')
                OR si.proposed_score IS NULL
              )
          ) AS needs_manual_score
        FROM public.submissions s
        WHERE s.status IN ('submitted', 'review', 'needs_revision')
      )
      SELECT
        p.id AS submission_id,
        p.title AS submission_title,
        u.student_id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS student_name,
        p.waiting_hours,
        p.missing_proof_file,
        p.needs_manual_score
      FROM pending p
      LEFT JOIN public.users u ON u.id = p.user_id
      ORDER BY
        p.created_at ASC,
        p.missing_proof_file DESC,
        (p.created_at <= NOW() - INTERVAL '24 hours') DESC,
        p.needs_manual_score DESC
      LIMIT $1::int
      `,
      [limit],
    );
    return result.rows;
  }

  async countRecentActivity(): Promise<number> {
    const result = await this.app.db.query<{ c: string }>(
      `
      WITH base AS (
        SELECT
          CASE
            WHEN al.action = 'admin_moderation_approve' THEN 'moderation_submission_approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'moderation_submission_rejected'
            WHEN al.action = 'admin_override_score' THEN 'moderation_submission_score_overridden'
            WHEN al.action = 'admin_override_status' THEN 'moderation_submission_status_overridden'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'approved' THEN 'moderation_submission_approved'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'rejected' THEN 'moderation_submission_rejected'
            WHEN al.action IN (
              'moderation_item_approved',
              'moderation_item_rejected',
              'moderation_item_score_changed',
              'moderation_item_comment_changed',
              'moderation_submission_approved',
              'moderation_submission_rejected',
              'moderation_submission_status_overridden',
              'moderation_submission_score_overridden',
              'project_phase_changed',
              'project_deadlines_changed',
              'student_profile_updated'
            ) THEN al.action
            ELSE NULL
          END AS action
        FROM public.audit_logs al
      )
      SELECT COUNT(*)::text AS c
      FROM base
      WHERE action IS NOT NULL
      `,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listRecentActivity(page: number, pageSize: number): Promise<AdminActivityRow[]> {
    const offset = (page - 1) * pageSize;
    const result = await this.app.db.query<AdminActivityRow>(
      `
      WITH base AS (
        SELECT
          al.id::text AS activity_id,
          al.user_id::text AS admin_id,
          COALESCE(
            NULLIF(BTRIM(au.student_full_name), ''),
            NULLIF(BTRIM(au.full_name), ''),
            NULLIF(BTRIM(au.email), ''),
            'Admin'
          ) AS admin_name,
          au.email::text AS admin_email,
          su.student_id::text AS student_id,
          COALESCE(NULLIF(BTRIM(su.student_full_name), ''), NULLIF(BTRIM(su.full_name), '')) AS student_name,
          COALESCE(
            CASE
              WHEN al.entity_table = 'submissions'
                AND al.entity_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN al.entity_id::text
              ELSE NULL
            END,
            s.id::text
          ) AS submission_id,
          COALESCE(
            NULLIF(BTRIM(s.title), ''),
            (
              SELECT NULLIF(BTRIM(si.title), '')
              FROM public.submission_items si
              WHERE si.submission_id = s.id
              ORDER BY si.created_at ASC
              LIMIT 1
            )
          ) AS submission_title,
          COALESCE(
            s.created_at,
            s.submitted_at,
            (
              SELECT MIN(si.created_at)
              FROM public.submission_items si
              WHERE si.submission_id = s.id
            )
          ) AS submission_submitted_at,
          CASE
            WHEN al.action = 'admin_moderation_approve' THEN 'moderation_submission_approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'moderation_submission_rejected'
            WHEN al.action = 'admin_override_score' THEN 'moderation_submission_score_overridden'
            WHEN al.action = 'admin_override_status' THEN 'moderation_submission_status_overridden'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'approved' THEN 'moderation_submission_approved'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'rejected' THEN 'moderation_submission_rejected'
            WHEN al.action IN (
              'moderation_item_approved',
              'moderation_item_rejected',
              'moderation_item_score_changed',
              'moderation_item_comment_changed',
              'moderation_submission_approved',
              'moderation_submission_rejected',
              'moderation_submission_status_overridden',
              'moderation_submission_score_overridden',
              'project_phase_changed',
              'project_deadlines_changed',
              'student_profile_updated'
            ) THEN al.action
            ELSE NULL
          END AS action,
          al.created_at
        FROM public.audit_logs al
        LEFT JOIN public.users au ON au.id = al.user_id
        LEFT JOIN public.submissions s ON s.id =
          CASE
            WHEN al.entity_table = 'submissions'
              AND al.entity_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN al.entity_id::text::uuid
            ELSE NULL
          END
        LEFT JOIN public.users su ON su.id = COALESCE(al.target_user_id, s.user_id)
      )
      SELECT
        activity_id,
        admin_id,
        admin_name,
        admin_email,
        student_id,
        student_name,
        submission_id,
        submission_title,
        submission_submitted_at,
        action,
        created_at
      FROM base
      WHERE action IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $1::int OFFSET $2::int
      `,
      [pageSize, offset],
    );
    return result.rows;
  }

  async getAdminActivitySummary(adminId: string): Promise<AdminActivitySummaryRow> {
    const result = await this.app.db.query<AdminActivitySummaryRow>(
      `
      WITH base AS (
        SELECT
          CASE
            WHEN al.action = 'admin_moderation_approve' THEN 'moderation_submission_approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'moderation_submission_rejected'
            WHEN al.action = 'admin_override_score' THEN 'moderation_submission_score_overridden'
            WHEN al.action = 'admin_override_status' THEN 'moderation_submission_status_overridden'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'approved' THEN 'moderation_submission_approved'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'rejected' THEN 'moderation_submission_rejected'
            WHEN al.action IN (
              'moderation_item_approved',
              'moderation_item_rejected',
              'moderation_item_score_changed',
              'moderation_item_comment_changed',
              'moderation_submission_approved',
              'moderation_submission_rejected',
              'moderation_submission_status_overridden',
              'moderation_submission_score_overridden',
              'project_phase_changed',
              'project_deadlines_changed',
              'student_profile_updated'
            ) THEN al.action
            ELSE NULL
          END AS action
        FROM public.audit_logs al
        WHERE al.user_id = $1::uuid
      )
      SELECT
        COUNT(*)::text AS total_actions,
        COUNT(*) FILTER (
          WHERE action IN ('moderation_item_approved', 'moderation_submission_approved')
        )::text AS approvals,
        COUNT(*) FILTER (
          WHERE action IN ('moderation_item_rejected', 'moderation_submission_rejected')
        )::text AS rejects
      FROM base
      WHERE action IS NOT NULL
      `,
      [adminId],
    );
    return (
      result.rows[0] ?? {
        total_actions: "0",
        approvals: "0",
        rejects: "0",
      }
    );
  }

  async findAdminUserById(adminId: string): Promise<{ id: string; email: string | null; name: string } | null> {
    const result = await this.app.db.query<{ id: string; email: string | null; name: string }>(
      `
      SELECT
        u.id::text AS id,
        u.email::text AS email,
        COALESCE(
          NULLIF(BTRIM(u.student_full_name), ''),
          NULLIF(BTRIM(u.full_name), ''),
          NULLIF(BTRIM(u.email), ''),
          'Admin'
        ) AS name
      FROM public.users u
      WHERE u.id = $1::uuid
      LIMIT 1
      `,
      [adminId],
    );
    return result.rows[0] ?? null;
  }

  async listRecentActivityByAdmin(adminId: string, page: number, pageSize: number): Promise<AdminActivityRow[]> {
    const offset = (page - 1) * pageSize;
    const result = await this.app.db.query<AdminActivityRow>(
      `
      WITH base AS (
        SELECT
          al.id::text AS activity_id,
          al.user_id::text AS admin_id,
          COALESCE(
            NULLIF(BTRIM(au.student_full_name), ''),
            NULLIF(BTRIM(au.full_name), ''),
            NULLIF(BTRIM(au.email), ''),
            'Admin'
          ) AS admin_name,
          au.email::text AS admin_email,
          su.student_id::text AS student_id,
          COALESCE(NULLIF(BTRIM(su.student_full_name), ''), NULLIF(BTRIM(su.full_name), '')) AS student_name,
          COALESCE(
            CASE
              WHEN al.entity_table = 'submissions'
                AND al.entity_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN al.entity_id::text
              ELSE NULL
            END,
            s.id::text
          ) AS submission_id,
          COALESCE(
            NULLIF(BTRIM(s.title), ''),
            (
              SELECT NULLIF(BTRIM(si.title), '')
              FROM public.submission_items si
              WHERE si.submission_id = s.id
              ORDER BY si.created_at ASC
              LIMIT 1
            )
          ) AS submission_title,
          COALESCE(
            s.created_at,
            s.submitted_at,
            (
              SELECT MIN(si.created_at)
              FROM public.submission_items si
              WHERE si.submission_id = s.id
            )
          ) AS submission_submitted_at,
          CASE
            WHEN al.action = 'admin_moderation_approve' THEN 'moderation_submission_approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'moderation_submission_rejected'
            WHEN al.action = 'admin_override_score' THEN 'moderation_submission_score_overridden'
            WHEN al.action = 'admin_override_status' THEN 'moderation_submission_status_overridden'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'approved' THEN 'moderation_submission_approved'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'rejected' THEN 'moderation_submission_rejected'
            WHEN al.action IN (
              'moderation_item_approved',
              'moderation_item_rejected',
              'moderation_item_score_changed',
              'moderation_item_comment_changed',
              'moderation_submission_approved',
              'moderation_submission_rejected',
              'moderation_submission_status_overridden',
              'moderation_submission_score_overridden',
              'project_phase_changed',
              'project_deadlines_changed',
              'student_profile_updated'
            ) THEN al.action
            ELSE NULL
          END AS action,
          al.created_at
        FROM public.audit_logs al
        LEFT JOIN public.users au ON au.id = al.user_id
        LEFT JOIN public.submissions s ON s.id =
          CASE
            WHEN al.entity_table = 'submissions'
              AND al.entity_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN al.entity_id::text::uuid
            ELSE NULL
          END
        LEFT JOIN public.users su ON su.id = COALESCE(al.target_user_id, s.user_id)
        WHERE al.user_id = $1::uuid
      )
      SELECT
        activity_id,
        admin_id,
        admin_name,
        admin_email,
        student_id,
        student_name,
        submission_id,
        submission_title,
        submission_submitted_at,
        action,
        created_at
      FROM base
      WHERE action IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $2::int OFFSET $3::int
      `,
      [adminId, pageSize, offset],
    );
    return result.rows;
  }

  async countRecentActivityByAdmin(adminId: string): Promise<number> {
    const result = await this.app.db.query<{ c: string }>(
      `
      WITH base AS (
        SELECT
          CASE
            WHEN al.action = 'admin_moderation_approve' THEN 'moderation_submission_approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'moderation_submission_rejected'
            WHEN al.action = 'admin_override_score' THEN 'moderation_submission_score_overridden'
            WHEN al.action = 'admin_override_status' THEN 'moderation_submission_status_overridden'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'approved' THEN 'moderation_submission_approved'
            WHEN al.action = 'review_completed'
              AND COALESCE(al.new_values->>'decision', '') = 'rejected' THEN 'moderation_submission_rejected'
            WHEN al.action IN (
              'moderation_item_approved',
              'moderation_item_rejected',
              'moderation_item_score_changed',
              'moderation_item_comment_changed',
              'moderation_submission_approved',
              'moderation_submission_rejected',
              'moderation_submission_status_overridden',
              'moderation_submission_score_overridden',
              'project_phase_changed',
              'project_deadlines_changed',
              'student_profile_updated'
            ) THEN al.action
            ELSE NULL
          END AS action
        FROM public.audit_logs al
        WHERE al.user_id = $1::uuid
      )
      SELECT COUNT(*)::text AS c
      FROM base
      WHERE action IS NOT NULL
      `,
      [adminId],
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async getMetrics(): Promise<AdminMetricsRow> {
    const result = await this.app.db.query<AdminMetricsRow>(
      `
      SELECT
        (
          SELECT COUNT(*)::text
          FROM public.submissions s
          WHERE s.status <> 'draft'
            AND s.status IN ('submitted', 'review', 'needs_revision')
        ) AS pending_count,
        (
          SELECT COUNT(*)::text
          FROM public.submissions s
          WHERE s.status = 'approved'
            AND s.reviewed_at IS NOT NULL
            AND (s.reviewed_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
        ) AS approved_today,
        (
          SELECT COUNT(*)::text
          FROM public.submissions s
          WHERE s.status = 'rejected'
            AND s.reviewed_at IS NOT NULL
            AND (s.reviewed_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
        ) AS rejected_today,
        (
          SELECT COUNT(*)::text
          FROM public.submissions s
          WHERE s.status IN ('approved', 'rejected')
        ) AS total_processed
      `,
    );

    return (
      result.rows[0] ?? {
        pending_count: "0",
        approved_today: "0",
        rejected_today: "0",
        total_processed: "0",
      }
    );
  }

  async countSubmissions(query: AdminSubmissionsQuery, semesterDb: AdminSemesterDb): Promise<number> {
    const { whereSql, params } = buildAdminSubmissionFilters(query, semesterDb);

    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM public.submissions s
      LEFT JOIN public.users u ON u.id = s.user_id
      ${whereSql}
      `,
      params,
    );

    return Number(result.rows[0]?.c ?? "0");
  }

  async listSubmissions(query: AdminSubmissionsQuery, semesterDb: AdminSemesterDb): Promise<AdminSubmissionListRow[]> {
    const hasSemesterCol = await getSubmissionsSemesterColumnPresent(this.app);
    const { whereSql, params } = buildAdminSubmissionFilters(query, semesterDb);
    const offset = (query.page - 1) * query.pageSize;
    const semesterSelect = hasSemesterCol ? `s.semester::text AS semester` : `NULL::text AS semester`;

    const categoryDisplayTerms: string[] = [];
    const pushDisplayTerm = (value: string | undefined): void => {
      const term = value?.trim();
      if (!term) {
        return;
      }
      if (categoryDisplayTerms.some((entry) => entry.toLowerCase() === term.toLowerCase())) {
        return;
      }
      categoryDisplayTerms.push(term);
    };
    pushDisplayTerm(query.category);
    pushDisplayTerm(query.categoryKey);

    let displayCategoryOrderSql = "si.created_at ASC";
    if (categoryDisplayTerms.length > 0) {
      const matchClauses: string[] = [];
      for (const term of categoryDisplayTerms) {
        const paramIdx = params.length + 1;
        params.push(term);
        matchClauses.push(`
          c.code = $${paramIdx}
          OR lower(c.name) = lower($${paramIdx})
          OR lower(COALESCE(c.title, '')) = lower($${paramIdx})
          OR lower(regexp_replace(c.name, '[_-]+', ' ', 'g')) = lower($${paramIdx})
          OR lower(c.name) = lower(regexp_replace($${paramIdx}, '\\s+', '_', 'g'))
        `);
      }
      displayCategoryOrderSql = `
        CASE
          WHEN ${matchClauses.map((clause) => `(${clause})`).join(" OR ")} THEN 0
          ELSE 1
        END ASC,
        si.created_at ASC
      `;
    }

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    params.push(query.pageSize, offset);

    const result = await this.app.db.query<AdminSubmissionListRow>(
      `
      SELECT
        s.id,
        s.user_id,
        u.student_id,
        s.title,
        s.status::text AS db_status,
        ${semesterSelect},
        s.created_at,
        COALESCE(s.submitted_at, s.created_at) AS submitted_at,
        CASE
          WHEN s.status IN ('approved', 'rejected') THEN s.total_score::text
          ELSE NULL
        END AS score,
        first_item.category_code,
        first_item.category_title,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS owner_name
      FROM public.submissions s
      LEFT JOIN public.users u ON u.id = s.user_id
      LEFT JOIN LATERAL (
        SELECT
          c.code AS category_code,
          COALESCE(
            NULLIF(btrim(c.title::text), ''),
            initcap(regexp_replace(c.name, '_', ' ', 'g'))
          ) AS category_title
        FROM public.submission_items si
        LEFT JOIN public.categories c ON c.id = si.category_id
        WHERE si.submission_id = s.id
        ORDER BY ${displayCategoryOrderSql}
        LIMIT 1
      ) first_item ON true
      ${whereSql}
      ORDER BY
        CASE
          WHEN s.status IN ('submitted', 'review', 'needs_revision') THEN 0
          WHEN s.status = 'approved' THEN 1
          WHEN s.status = 'rejected' THEN 2
          ELSE 3
        END ASC,
        CASE
          WHEN s.status IN ('submitted', 'review', 'needs_revision') THEN COALESCE(s.submitted_at, s.created_at)
          ELSE NULL
        END ASC NULLS LAST,
        CASE
          WHEN s.status NOT IN ('submitted', 'review', 'needs_revision') THEN COALESCE(s.reviewed_at, s.updated_at, s.created_at)
          ELSE NULL
        END DESC NULLS LAST,
        s.id ASC
      LIMIT $${limitParam}::int OFFSET $${offsetParam}::int
      `,
      params,
    );

    return result.rows;
  }

  async countSubmissionGroups(query: AdminSubmissionsQuery, semesterDb: AdminSemesterDb): Promise<number> {
    const { whereSql, params } = buildAdminSubmissionFilters(query, semesterDb);
    const result = await this.app.db.query<{ c: string }>(
      `
      WITH filtered AS (
        SELECT
          s.id,
          ${buildStudentIdentityGroupHashSql("u")} AS group_key
        FROM public.submissions s
        LEFT JOIN public.users u ON u.id = s.user_id
        ${whereSql}
      )
      SELECT COUNT(DISTINCT group_key)::text AS c
      FROM filtered
      `,
      params,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listSubmissionGroups(
    query: AdminSubmissionsQuery,
    semesterDb: AdminSemesterDb,
  ): Promise<AdminSubmissionGroupListRow[]> {
    const hasSemesterCol = await getSubmissionsSemesterColumnPresent(this.app);
    const { whereSql, params } = buildAdminSubmissionFilters(query, semesterDb);
    const offset = (query.page - 1) * query.pageSize;
    const semesterSelect = hasSemesterCol ? `s.semester::text AS semester` : `NULL::text AS semester`;

    const categoryDisplayTerms: string[] = [];
    const pushDisplayTerm = (value: string | undefined): void => {
      const term = value?.trim();
      if (!term) {
        return;
      }
      if (categoryDisplayTerms.some((entry) => entry.toLowerCase() === term.toLowerCase())) {
        return;
      }
      categoryDisplayTerms.push(term);
    };
    pushDisplayTerm(query.category);
    pushDisplayTerm(query.categoryKey);

    let displayCategoryOrderSql = "si.created_at ASC";
    if (categoryDisplayTerms.length > 0) {
      const matchClauses: string[] = [];
      for (const term of categoryDisplayTerms) {
        const paramIdx = params.length + 1;
        params.push(term);
        matchClauses.push(`
          c.code = $${paramIdx}
          OR lower(c.name) = lower($${paramIdx})
          OR lower(COALESCE(c.title, '')) = lower($${paramIdx})
          OR lower(regexp_replace(c.name, '[_-]+', ' ', 'g')) = lower($${paramIdx})
          OR lower(c.name) = lower(regexp_replace($${paramIdx}, '\\s+', '_', 'g'))
        `);
      }
      displayCategoryOrderSql = `
        CASE
          WHEN ${matchClauses.map((clause) => `(${clause})`).join(" OR ")} THEN 0
          ELSE 1
        END ASC,
        si.created_at ASC
      `;
    }

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    params.push(query.pageSize, offset);

    const result = await this.app.db.query<AdminSubmissionGroupListRow>(
      `
      WITH base AS (
        SELECT
          s.id,
          s.user_id,
          u.student_id,
          s.title,
          s.status::text AS db_status,
          ${semesterSelect},
          s.created_at,
          COALESCE(s.submitted_at, s.created_at) AS submitted_at,
          CASE
            WHEN s.status IN ('approved', 'rejected') THEN s.total_score::text
            ELSE NULL
          END AS score,
          first_item.category_code,
          first_item.category_title,
          COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS owner_name,
          ${buildStudentIdentityGroupHashSql("u")} AS group_key
        FROM public.submissions s
        LEFT JOIN public.users u ON u.id = s.user_id
        LEFT JOIN LATERAL (
          SELECT
            c.code AS category_code,
            COALESCE(
              NULLIF(btrim(c.title::text), ''),
              initcap(regexp_replace(c.name, '_', ' ', 'g'))
            ) AS category_title
          FROM public.submission_items si
          LEFT JOIN public.categories c ON c.id = si.category_id
          WHERE si.submission_id = s.id
          ORDER BY ${displayCategoryOrderSql}
          LIMIT 1
        ) first_item ON true
        ${whereSql}
      ),
      ranked AS (
        SELECT
          b.*,
          COUNT(*) OVER (PARTITION BY b.group_key)::text AS submissions_count,
          COUNT(*) FILTER (
            WHERE b.db_status IN ('submitted', 'review', 'needs_revision')
          ) OVER (PARTITION BY b.group_key)::int AS pending_count,
          COUNT(*) FILTER (
            WHERE b.db_status = 'approved'
          ) OVER (PARTITION BY b.group_key)::int AS approved_count,
          ROW_NUMBER() OVER (
            PARTITION BY b.group_key
            ORDER BY b.submitted_at DESC, b.created_at DESC, b.id DESC
          ) AS rn
        FROM base b
      )
      SELECT
        r.group_key,
        r.submissions_count,
        r.id AS latest_submission_id,
        r.user_id,
        r.student_id,
        r.title,
        CASE
          WHEN r.pending_count > 0 THEN 'submitted'
          WHEN r.approved_count > 0 THEN 'approved'
          ELSE 'rejected'
        END::text AS db_status,
        r.semester,
        r.created_at,
        r.submitted_at,
        r.score,
        r.category_code,
        r.category_title,
        r.owner_name
      FROM ranked r
      WHERE r.rn = 1
      ORDER BY
        CASE
          WHEN r.db_status IN ('submitted', 'review', 'needs_revision') THEN 0
          WHEN r.db_status = 'approved' THEN 1
          WHEN r.db_status = 'rejected' THEN 2
          ELSE 3
        END ASC,
        r.submitted_at DESC,
        r.created_at DESC,
        latest_submission_id DESC
      LIMIT $${limitParam}::int OFFSET $${offsetParam}::int
      `,
      params,
    );

    return result.rows;
  }

  async countSubmissionGroupItems(groupKey: string, semesterDb: AdminSemesterDb): Promise<number> {
    const params: unknown[] = [groupKey];
    let whereSql = `
      WHERE s.status <> 'draft'
        AND ${buildStudentIdentityGroupHashSql("u")} = $1
    `;
    if (semesterDb !== null) {
      whereSql += ` AND s.semester = $2`;
      params.push(semesterDb);
    }
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM public.submissions s
      LEFT JOIN public.users u ON u.id = s.user_id
      ${whereSql}
      `,
      params,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listSubmissionGroupItems(input: {
    groupKey: string;
    page: number;
    pageSize: number;
    semesterDb: AdminSemesterDb;
  }): Promise<AdminSubmissionListRow[]> {
    const hasSemesterCol = await getSubmissionsSemesterColumnPresent(this.app);
    const semesterSelect = hasSemesterCol ? `s.semester::text AS semester` : `NULL::text AS semester`;
    const offset = (input.page - 1) * input.pageSize;
    const params: unknown[] = [input.groupKey];
    let whereSql = `
      WHERE s.status <> 'draft'
        AND ${buildStudentIdentityGroupHashSql("u")} = $1
    `;
    if (input.semesterDb !== null) {
      whereSql += ` AND s.semester = $2`;
      params.push(input.semesterDb);
    }
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    params.push(input.pageSize, offset);

    const result = await this.app.db.query<AdminSubmissionListRow>(
      `
      SELECT
        s.id,
        s.user_id,
        u.student_id,
        s.title,
        s.status::text AS db_status,
        ${semesterSelect},
        s.created_at,
        COALESCE(s.submitted_at, s.created_at) AS submitted_at,
        CASE
          WHEN s.status IN ('approved', 'rejected') THEN s.total_score::text
          ELSE NULL
        END AS score,
        first_item.category_code,
        first_item.category_title,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS owner_name
      FROM public.submissions s
      LEFT JOIN public.users u ON u.id = s.user_id
      LEFT JOIN LATERAL (
        SELECT
          c.code AS category_code,
          COALESCE(
            NULLIF(btrim(c.title::text), ''),
            initcap(regexp_replace(c.name, '_', ' ', 'g'))
          ) AS category_title
        FROM public.submission_items si
        LEFT JOIN public.categories c ON c.id = si.category_id
        WHERE si.submission_id = s.id
        ORDER BY si.created_at ASC
        LIMIT 1
      ) first_item ON true
      ${whereSql}
      ORDER BY COALESCE(s.submitted_at, s.created_at) DESC, s.created_at DESC, s.id DESC
      LIMIT $${limitParam}::int OFFSET $${offsetParam}::int
      `,
      params,
    );

    return result.rows;
  }

  async searchSuggestions(queryText: string, limit: number): Promise<AdminSearchSuggestionRow[]> {
    const raw = queryText.trim();
    if (!raw) {
      return [];
    }
    const safeLimit = Math.max(1, Math.min(limit, 20));
    const pattern = `%${raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const normalized = normalizeStudentId(raw);
    const normalizedPrefix = `${normalized.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

    const result = await this.app.db.query<AdminSearchSuggestionRow>(
      `
      WITH input AS (
        SELECT
          $1::text AS pattern,
          $2::text AS normalized_prefix,
          $3::int AS lim
      ),
      student_id_hits AS (
        SELECT DISTINCT
          'student_id'::text AS kind,
          u.student_id::text AS value,
          u.student_id::text AS label,
          COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS meta
        FROM public.users u, input i
        WHERE COALESCE(u.student_id, '') <> ''
          AND upper(regexp_replace(u.student_id::text, '\\s+', '', 'g')) LIKE i.normalized_prefix ESCAPE '\\'
        LIMIT (SELECT lim FROM input)
      ),
      title_hits AS (
        SELECT
          'title'::text AS kind,
          s.title::text AS value,
          s.title::text AS label,
          u.student_id::text AS meta
        FROM public.submissions s
        LEFT JOIN public.users u ON u.id = s.user_id
        CROSS JOIN input i
        WHERE COALESCE(s.title, '') ILIKE i.pattern ESCAPE '\\'
        ORDER BY s.created_at DESC
        LIMIT (SELECT lim FROM input)
      )
      SELECT kind::text, value::text, label::text, meta::text
      FROM (
        SELECT * FROM student_id_hits
        UNION ALL
        SELECT * FROM title_hits
      ) all_hits
      WHERE value IS NOT NULL AND BTRIM(value) <> ''
      LIMIT $3::int
      `,
      [pattern, normalizedPrefix, safeLimit],
    );
    return result.rows;
  }

  async findStudentOverviewByStudentId(
    studentIdInput: string,
    semesterDb: AdminSemesterDb,
  ): Promise<AdminStudentOverviewRow | null> {
    const normalized = normalizeStudentId(studentIdInput);
    if (!normalized) {
      return null;
    }

    const joinOn = adminStudentOverviewJoinOnSql(semesterDb);

    const result = await this.app.db.query<AdminStudentOverviewRow>(
      `
      SELECT
        u.id::text AS user_id,
        u.student_id::text AS student_id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS student_name,
        u.faculty::text AS faculty,
        u.telegram_username::text AS telegram_username,
        COUNT(s.id)::text AS total_submissions,
        COUNT(*) FILTER (WHERE s.status IN ('submitted', 'review', 'needs_revision'))::text AS pending_submissions,
        COUNT(*) FILTER (WHERE s.status = 'approved')::text AS approved_submissions,
        COUNT(*) FILTER (WHERE s.status = 'rejected')::text AS rejected_submissions,
        COALESCE(SUM(s.total_score) FILTER (WHERE s.status = 'approved'), 0)::text AS total_approved_score
      FROM public.users u
      LEFT JOIN public.submissions s ON ${joinOn}
      WHERE upper(regexp_replace(COALESCE(u.student_id, ''), '\\s+', '', 'g')) = $1
      GROUP BY u.id, u.student_id, u.student_full_name, u.full_name, u.faculty, u.telegram_username
      LIMIT 1
      `,
      [normalized],
    );

    return result.rows[0] ?? null;
  }

  async countStudents(query: AdminStudentsQuery): Promise<number> {
    const { whereSql, params } = buildAdminStudentsFilters(query);
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM public.users u
      ${whereSql}
      `,
      params,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listStudents(query: AdminStudentsQuery, semesterDb: AdminSemesterDb): Promise<AdminStudentListRow[]> {
    const { whereSql, params } = buildAdminStudentsFilters(query);
    const offset = (query.page - 1) * query.pageSize;
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    params.push(query.pageSize, offset);

    const semSql = adminStudentSubmissionsSemesterWhereSql(semesterDb);

    let orderBy = "u.created_at DESC, u.id ASC";
    if (query.sort === "oldest") {
      orderBy = "u.created_at ASC, u.id ASC";
    } else if (query.sort === "name") {
      orderBy = "COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) ASC NULLS LAST, u.created_at DESC";
    }

    const sqlWithPhone = `
      SELECT
        u.id::text AS id,
        u.full_name::text AS full_name,
        u.student_full_name::text AS student_full_name,
        u.telegram_username::text AS telegram_username,
        u.telegram_id::text AS telegram_id,
        u.phone::text AS phone,
        u.degree::text AS degree,
        u.faculty::text AS faculty,
        u.student_id::text AS student_id,
        u.created_at::timestamptz::text AS registration_date,
        COALESCE(activity.last_activity_at, u.updated_at)::timestamptz::text AS last_activity_at,
        COALESCE(activity.total_achievements_submitted, 0)::text AS total_achievements_submitted,
        COALESCE(activity.total_approved_score, 0)::text AS total_approved_score
      FROM public.users u
      LEFT JOIN LATERAL (
        SELECT
          MAX(COALESCE(s.updated_at, s.submitted_at, s.created_at)) AS last_activity_at,
          COALESCE(COUNT(si.id), 0) AS total_achievements_submitted,
          COALESCE(SUM(s.total_score) FILTER (WHERE s.status = 'approved'), 0) AS total_approved_score
        FROM public.submissions s
        LEFT JOIN public.submission_items si ON si.submission_id = s.id
        WHERE s.user_id = u.id${semSql}
      ) activity ON true
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${limitParam}::int OFFSET $${offsetParam}::int
    `;
    const sqlLegacy = `
      SELECT
        u.id::text AS id,
        u.full_name::text AS full_name,
        u.student_full_name::text AS student_full_name,
        u.telegram_username::text AS telegram_username,
        u.telegram_id::text AS telegram_id,
        NULL::text AS phone,
        u.degree::text AS degree,
        u.faculty::text AS faculty,
        u.student_id::text AS student_id,
        u.created_at::timestamptz::text AS registration_date,
        COALESCE(activity.last_activity_at, u.updated_at)::timestamptz::text AS last_activity_at,
        COALESCE(activity.total_achievements_submitted, 0)::text AS total_achievements_submitted,
        COALESCE(activity.total_approved_score, 0)::text AS total_approved_score
      FROM public.users u
      LEFT JOIN LATERAL (
        SELECT
          MAX(COALESCE(s.updated_at, s.submitted_at, s.created_at)) AS last_activity_at,
          COALESCE(COUNT(si.id), 0) AS total_achievements_submitted,
          COALESCE(SUM(s.total_score) FILTER (WHERE s.status = 'approved'), 0) AS total_approved_score
        FROM public.submissions s
        LEFT JOIN public.submission_items si ON si.submission_id = s.id
        WHERE s.user_id = u.id${semSql}
      ) activity ON true
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${limitParam}::int OFFSET $${offsetParam}::int
    `;
    try {
      const result = await this.app.db.query<AdminStudentListRow>(sqlWithPhone, params);
      return result.rows;
    } catch (error) {
      if (!isPgUndefinedColumnError(error)) {
        throw error;
      }
      const legacy = await this.app.db.query<AdminStudentListRow>(sqlLegacy, params);
      return legacy.rows;
    }
  }

  async findStudentById(studentId: string, semesterDb: AdminSemesterDb): Promise<AdminStudentDetailRow | null> {
    const semSql = adminStudentSubmissionsSemesterWhereSql(semesterDb);

    const sqlWithPhone = `
      SELECT
        u.id::text AS id,
        u.full_name::text AS full_name,
        u.student_full_name::text AS student_full_name,
        u.telegram_username::text AS telegram_username,
        u.telegram_id::text AS telegram_id,
        u.phone::text AS phone,
        u.degree::text AS degree,
        u.faculty::text AS faculty,
        u.student_id::text AS student_id,
        u.email::text AS email,
        u.is_profile_completed,
        u.created_at::timestamptz::text AS created_at,
        u.updated_at::timestamptz::text AS updated_at,
        COALESCE(activity.last_activity_at, u.updated_at)::timestamptz::text AS last_activity_at,
        COALESCE(activity.total_achievements_submitted, 0)::text AS total_achievements_submitted,
        COALESCE(activity.total_submissions, 0)::text AS total_submissions,
        COALESCE(activity.total_approved_score, 0)::text AS total_approved_score
      FROM public.users u
      LEFT JOIN LATERAL (
        SELECT
          MAX(COALESCE(s.updated_at, s.submitted_at, s.created_at)) AS last_activity_at,
          COALESCE(COUNT(si.id), 0) AS total_achievements_submitted,
          COALESCE(COUNT(DISTINCT s.id), 0) AS total_submissions,
          COALESCE(SUM(s.total_score) FILTER (WHERE s.status = 'approved'), 0) AS total_approved_score
        FROM public.submissions s
        LEFT JOIN public.submission_items si ON si.submission_id = s.id
        WHERE s.user_id = u.id${semSql}
      ) activity ON true
      WHERE u.id = $1::uuid
        AND u.role::text = 'student'
        AND u.telegram_id IS NOT NULL
      LIMIT 1
    `;
    const sqlLegacy = `
      SELECT
        u.id::text AS id,
        u.full_name::text AS full_name,
        u.student_full_name::text AS student_full_name,
        u.telegram_username::text AS telegram_username,
        u.telegram_id::text AS telegram_id,
        NULL::text AS phone,
        u.degree::text AS degree,
        u.faculty::text AS faculty,
        u.student_id::text AS student_id,
        u.email::text AS email,
        u.is_profile_completed,
        u.created_at::timestamptz::text AS created_at,
        u.updated_at::timestamptz::text AS updated_at,
        COALESCE(activity.last_activity_at, u.updated_at)::timestamptz::text AS last_activity_at,
        COALESCE(activity.total_achievements_submitted, 0)::text AS total_achievements_submitted,
        COALESCE(activity.total_submissions, 0)::text AS total_submissions,
        COALESCE(activity.total_approved_score, 0)::text AS total_approved_score
      FROM public.users u
      LEFT JOIN LATERAL (
        SELECT
          MAX(COALESCE(s.updated_at, s.submitted_at, s.created_at)) AS last_activity_at,
          COALESCE(COUNT(si.id), 0) AS total_achievements_submitted,
          COALESCE(COUNT(DISTINCT s.id), 0) AS total_submissions,
          COALESCE(SUM(s.total_score) FILTER (WHERE s.status = 'approved'), 0) AS total_approved_score
        FROM public.submissions s
        LEFT JOIN public.submission_items si ON si.submission_id = s.id
        WHERE s.user_id = u.id${semSql}
      ) activity ON true
      WHERE u.id = $1::uuid
        AND u.role::text = 'student'
        AND u.telegram_id IS NOT NULL
      LIMIT 1
    `;
    try {
      const result = await this.app.db.query<AdminStudentDetailRow>(sqlWithPhone, [studentId]);
      return result.rows[0] ?? null;
    } catch (error) {
      if (!isPgUndefinedColumnError(error)) {
        throw error;
      }
      const legacy = await this.app.db.query<AdminStudentDetailRow>(sqlLegacy, [studentId]);
      return legacy.rows[0] ?? null;
    }
  }

  async updateStudentById(studentId: string, body: AdminUpdateStudentBody): Promise<void> {
    const duplicate = await this.app.db.query<{ id: string }>(
      `
      SELECT u.id::text
      FROM public.users u
      WHERE u.id <> $1::uuid
        AND upper(regexp_replace(COALESCE(u.student_id::text, ''), '\\s+', '', 'g')) = $2
      LIMIT 1
      `,
      [studentId, body.student_id],
    );
    if (duplicate.rows[0]) {
      throw new ServiceError(409, "Student ID already exists", "DUPLICATE_STUDENT_ID");
    }
    if (body.email && body.email.trim()) {
      const duplicateEmail = await this.app.db.query<{ id: string }>(
        `
        SELECT u.id::text
        FROM public.users u
        WHERE u.id <> $1::uuid
          AND lower(COALESCE(u.email::text, '')) = lower($2::text)
        LIMIT 1
        `,
        [studentId, body.email.trim()],
      );
      if (duplicateEmail.rows[0]) {
        throw new ServiceError(409, "Email already exists", "DUPLICATE_EMAIL");
      }
    }

    const params: unknown[] = [studentId, body.full_name, body.degree, body.faculty, body.student_id];
    let emailSql = "";
    if (body.email !== undefined) {
      params.push(body.email ? body.email.trim().toLowerCase() : null);
      emailSql = `, email = $${params.length}::citext`;
    }
    let phoneSql = "";
    if ((await getUsersPhoneColumnPresent(this.app)) && body.phone !== undefined) {
      params.push(body.phone);
      phoneSql = `, phone = $${params.length}::text`;
    }

    const result = await this.app.db.query(
      `
      UPDATE public.users
      SET
        student_full_name = $2,
        full_name = $2,
        degree = $3::text,
        faculty = $4,
        student_id = $5,
        is_profile_completed = true
        ${emailSql}
        ${phoneSql},
        updated_at = NOW()
      WHERE id = $1::uuid
        AND role::text = 'student'
        AND telegram_id IS NOT NULL
      `,
      params,
    );
    if (result.rowCount !== 1) {
      throw new ServiceError(404, "Student not found");
    }
  }

  async findSubmissionById(submissionId: string): Promise<AdminSubmissionDetailRow | null> {
    const result = await this.app.db.query<AdminSubmissionDetailRow>(
      `
      SELECT
        s.id,
        s.user_id,
        s.title,
        s.description,
        s.status::text AS db_status,
        s.total_score::text,
        s.submitted_at,
        s.reviewed_at,
        s.reviewed_by::text,
        reviewer.email::text AS reviewed_by_email,
        s.created_at,
        s.updated_at
      FROM public.submissions s
      LEFT JOIN public.users reviewer ON reviewer.id = s.reviewed_by
      WHERE s.id = $1
      `,
      [submissionId],
    );

    return result.rows[0] ?? null;
  }

  async findSubmissionForUpdate(
    client: PoolClient,
    submissionId: string,
  ): Promise<AdminSubmissionDetailRow | null> {
    const result = await client.query<AdminSubmissionDetailRow>(
      `
      SELECT
        s.id,
        s.user_id,
        s.title,
        s.description,
        s.status::text AS db_status,
        s.total_score::text,
        s.submitted_at,
        s.reviewed_at,
        s.reviewed_by::text,
        reviewer.email::text AS reviewed_by_email,
        s.created_at,
        s.updated_at
      FROM public.submissions s
      LEFT JOIN public.users reviewer ON reviewer.id = s.reviewed_by
      WHERE s.id = $1
      FOR UPDATE OF s
      `,
      [submissionId],
    );

    return result.rows[0] ?? null;
  }

  async findUserById(client: AdminDbExecutor, userId: string): Promise<AdminUserRow | null> {
    const db = client;
    try {
      const result = await db.query<AdminUserRow>(
        `
        SELECT
          student_full_name,
          faculty,
          student_id,
          telegram_username,
          phone
        FROM public.users
        WHERE id = $1
        `,
        [userId],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (!isPgUndefinedColumnError(error)) {
        throw error;
      }
      const legacy = await db.query<AdminUserRow>(
        `
        SELECT
          student_full_name,
          faculty,
          student_id,
          telegram_username,
          NULL::text AS phone
        FROM public.users
        WHERE id = $1
        `,
        [userId],
      );
      return legacy.rows[0] ?? null;
    }
  }

  async listItemsForSubmission(
    client: AdminDbExecutor,
    submissionId: string,
  ): Promise<AdminItemRow[]> {
    const db = client;
    const result = await db.query<AdminItemRow>(
      `
      SELECT
        si.id,
        si.submission_id,
        s.user_id::text AS submission_user_id,
        si.title,
        si.description,
        si.proof_file_url,
        si.external_link,
        si.proposed_score::text AS proposed_score,
        si.approved_score::text AS approved_score,
        si.reviewer_comment::text AS reviewer_comment,
        si.status::text AS status,
        si.reviewed_by::text AS reviewed_by,
        si.reviewed_at AS reviewed_at,
        c.type::text AS category_type,
        c.code AS category_code,
        c.name AS category_name,
        COALESCE(
          NULLIF(BTRIM(c.title::text), ''),
          initcap(regexp_replace(COALESCE(c.name, c.code, 'unknown_category'), '[_-]+', ' ', 'g'))
        ) AS category_title,
        si.created_at,
        si.updated_at
      FROM public.submission_items si
      LEFT JOIN public.submissions s ON s.id = si.submission_id
      LEFT JOIN public.categories c ON c.id = si.category_id
      WHERE si.submission_id = $1
      ORDER BY si.created_at ASC
      `,
      [submissionId],
    );

    return result.rows;
  }

  async listFilesForSubmission(client: AdminDbExecutor, submissionId: string): Promise<AdminFileRow[]> {
    const db = client;
    const result = await db.query<AdminFileRow>(
      `
      SELECT
        f.id,
        f.submission_id,
        f.submission_item_id,
        f.bucket,
        f.storage_path,
        f.file_url,
        f.original_filename,
        f.mime_type,
        f.created_at
      FROM public.files f
      WHERE f.submission_id = $1
         OR f.submission_item_id IN (
           SELECT si.id FROM public.submission_items si WHERE si.submission_id = $1
         )
      ORDER BY f.created_at ASC
      `,
      [submissionId],
    );

    return result.rows;
  }

  async updateItemsApprove(
    client: PoolClient,
    submissionId: string,
    scores: { itemId: string; approvedScore: number }[],
    reviewedByUserId: string,
  ): Promise<void> {
    for (const row of scores) {
      let res;
      try {
        res = await client.query(
          `
          UPDATE public.submission_items
          SET
            approved_score = $2,
            status = 'approved'::public.submission_item_status,
            reviewed_at = NOW(),
            reviewed_by = $4::uuid,
            updated_at = NOW()
          WHERE id = $1 AND submission_id = $3
          `,
          [row.itemId, row.approvedScore, submissionId, reviewedByUserId],
        );
      } catch (error) {
        const pg = getPostgresDriverErrorFields(error);
        if (pg?.code !== "42703") {
          throw error;
        }
        // Backward-compat: legacy DB may not have reviewed_by/reviewed_at on submission_items.
        res = await client.query(
          `
          UPDATE public.submission_items
          SET
            approved_score = $2,
            status = 'approved'::public.submission_item_status,
            updated_at = NOW()
          WHERE id = $1 AND submission_id = $3
          `,
          [row.itemId, row.approvedScore, submissionId],
        );
      }
      if (res.rowCount !== 1) {
        throw new ServiceError(
          409,
          "A line item changed or was removed during approval. Refresh the page and try again.",
          "CONCURRENT_MODIFICATION",
        );
      }
    }
  }

  async updateItemsRejectAll(client: PoolClient, submissionId: string, reviewedByUserId: string): Promise<void> {
    try {
      await client.query(
        `
        UPDATE public.submission_items
        SET
          approved_score = NULL,
          status = 'rejected'::public.submission_item_status,
          reviewed_at = NOW(),
          reviewed_by = $2::uuid,
          updated_at = NOW()
        WHERE submission_id = $1
        `,
        [submissionId, reviewedByUserId],
      );
    } catch (error) {
      const pg = getPostgresDriverErrorFields(error);
      if (pg?.code !== "42703") {
        throw error;
      }
      await client.query(
        `
        UPDATE public.submission_items
        SET
          approved_score = NULL,
          status = 'rejected'::public.submission_item_status,
          updated_at = NOW()
        WHERE submission_id = $1
        `,
        [submissionId],
      );
    }
  }

  /**
   * Older DBs only allowed review → approved/rejected. Moderation often runs on `submitted` or
   * `needs_revision`; bridge through `review` so finalize succeeds even if migration
   * `20260430120000_admin_moderation_schema` was not applied.
   */
  async ensureSubmissionReadyForModerationFinalize(
    client: PoolClient,
    submissionId: string,
    currentDbStatus: string,
  ): Promise<void> {
    if (currentDbStatus === "review") {
      return;
    }
    if (currentDbStatus === "submitted") {
      const r = await client.query(
        `
        UPDATE public.submissions
        SET
          status = 'review'::public.submission_status,
          updated_at = NOW()
        WHERE id = $1 AND status = 'submitted'::public.submission_status
        `,
        [submissionId],
      );
      if (r.rowCount !== 1) {
        throw new ServiceError(
          409,
          "Submission status changed during moderation. Refresh the page and try again.",
          "CONCURRENT_MODIFICATION",
        );
      }
      return;
    }
    if (currentDbStatus === "needs_revision") {
      let r = await client.query(
        `
        UPDATE public.submissions
        SET
          status = 'submitted'::public.submission_status,
          updated_at = NOW()
        WHERE id = $1 AND status = 'needs_revision'::public.submission_status
        `,
        [submissionId],
      );
      if (r.rowCount !== 1) {
        throw new ServiceError(
          409,
          "Submission status changed during moderation. Refresh the page and try again.",
          "CONCURRENT_MODIFICATION",
        );
      }
      r = await client.query(
        `
        UPDATE public.submissions
        SET
          status = 'review'::public.submission_status,
          updated_at = NOW()
        WHERE id = $1 AND status = 'submitted'::public.submission_status
        `,
        [submissionId],
      );
      if (r.rowCount !== 1) {
        throw new ServiceError(
          409,
          "Submission status changed during moderation. Refresh the page and try again.",
          "CONCURRENT_MODIFICATION",
        );
      }
    }
  }

  async finalizeSubmission(
    client: PoolClient,
    input: { submissionId: string; status: "approved" | "rejected"; reviewedByUserId: string },
  ): Promise<AdminSubmissionDetailRow> {
    let result;
    try {
      result = await client.query<AdminSubmissionDetailRow>(
        `
        UPDATE public.submissions AS s
        SET
          status = $2::public.submission_status,
          reviewed_at = NOW(),
          reviewed_by = $3::uuid,
          updated_at = NOW()
        WHERE s.id = $1
        RETURNING
          s.id,
          s.user_id,
          s.title,
          s.description,
          s.status::text AS db_status,
          s.total_score::text,
          s.submitted_at,
          s.reviewed_at,
          s.reviewed_by::text,
          (
            SELECT u.email::text
            FROM public.users u
            WHERE u.id = s.reviewed_by
            LIMIT 1
          ) AS reviewed_by_email,
          s.created_at,
          s.updated_at
        `,
        [input.submissionId, input.status, input.reviewedByUserId],
      );
    } catch (error) {
      const pg = getPostgresDriverErrorFields(error);
      if (pg?.code !== "42703") {
        throw error;
      }
      // Backward-compat: legacy DB may not have submissions.reviewed_by/reviewed_at.
      result = await client.query<AdminSubmissionDetailRow>(
        `
        UPDATE public.submissions AS s
        SET
          status = $2::public.submission_status,
          updated_at = NOW()
        WHERE s.id = $1
        RETURNING
          s.id,
          s.user_id,
          s.title,
          s.description,
          s.status::text AS db_status,
          s.total_score::text,
          s.submitted_at,
          NULL::timestamptz AS reviewed_at,
          NULL::text AS reviewed_by,
          NULL::text AS reviewed_by_email,
          s.created_at,
          s.updated_at
        `,
        [input.submissionId, input.status],
      );
    }

    const row = result.rows[0];
    if (!row) {
      throw new ServiceError(500, "Failed to finalize submission", "FINALIZE_FAILED");
    }
    return row;
  }
}
