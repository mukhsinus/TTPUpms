import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { ServiceError } from "../../utils/service-error";
import type { AdminModerationStatus, AdminSubmissionsQuery } from "./admin.schema";

export interface AdminSubmissionListRow {
  id: string;
  user_id: string;
  student_id: string | null;
  title: string;
  db_status: string;
  created_at: string;
  submitted_at: string;
  score: string | null;
  category_code: string | null;
  category_title: string | null;
  subcategory_slug: string | null;
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
  status: string;
  category_code: string | null;
  category_name: string | null;
  category_title: string | null;
  subcategory_slug: string | null;
  subcategory_label: string | null;
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
  action: "approved" | "rejected" | "edited_score" | "reopened" | "login";
  created_at: string;
}

export interface AdminActivitySummaryRow {
  total_actions: string;
  approvals: string;
  rejects: string;
}

export type AdminDbExecutor = FastifyInstance["db"] | PoolClient;

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

/**
 * Shared WHERE builder for admin submission list + count (`u` join required for search).
 */
function buildAdminSubmissionFilters(query: AdminSubmissionsQuery): { whereSql: string; params: unknown[] } {
  const conditions: string[] = ["s.status <> 'draft'"];
  const params: unknown[] = [];
  let p = 1;

  if (query.status) {
    const f = moderationStatusFilterSql(query.status);
    conditions.push(f.clause);
    params.push(...f.params);
  }
  if (query.category) {
    conditions.push(`
      EXISTS (
        SELECT 1 FROM public.submission_items si2
        INNER JOIN public.categories c2 ON c2.id = si2.category_id
        WHERE si2.submission_id = s.id
          AND (
            c2.code = $${p}
            OR lower(c2.name) = lower($${p})
            OR lower(COALESCE(c2.title, '')) = lower($${p})
          )
      )
    `);
    params.push(query.category);
    p += 1;
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
    if (SUBMISSION_ID_UUID.test(raw)) {
      conditions.push(`s.id = $${p}::uuid`);
      params.push(raw);
      p += 1;
    } else {
      const escaped = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      conditions.push(
        `(s.title ILIKE $${p} ESCAPE '\\' OR COALESCE(u.student_full_name::text, u.full_name::text, '') ILIKE $${p} ESCAPE '\\' OR COALESCE(u.student_id::text, '') ILIKE $${p} ESCAPE '\\')`,
      );
      params.push(pattern);
      p += 1;
    }
  }

  return { whereSql: `WHERE ${conditions.join(" AND ")}`, params };
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
            WHEN al.action = 'admin_moderation_approve' THEN 'approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'rejected'
            WHEN al.action = 'admin_override_score' THEN 'edited_score'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') IN ('submitted', 'review', 'needs_revision') THEN 'reopened'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'approved' THEN 'approved'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'rejected' THEN 'rejected'
            WHEN al.action = 'login' THEN 'login'
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
            WHEN al.action = 'admin_moderation_approve' THEN 'approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'rejected'
            WHEN al.action = 'admin_override_score' THEN 'edited_score'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') IN ('submitted', 'review', 'needs_revision') THEN 'reopened'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'approved' THEN 'approved'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'rejected' THEN 'rejected'
            WHEN al.action = 'login' THEN 'login'
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
            WHEN al.action = 'admin_moderation_approve' THEN 'approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'rejected'
            WHEN al.action = 'admin_override_score' THEN 'edited_score'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') IN ('submitted', 'review', 'needs_revision') THEN 'reopened'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'approved' THEN 'approved'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'rejected' THEN 'rejected'
            WHEN al.action = 'login' THEN 'login'
            ELSE NULL
          END AS action
        FROM public.audit_logs al
        WHERE al.user_id = $1::uuid
      )
      SELECT
        COUNT(*)::text AS total_actions,
        COUNT(*) FILTER (WHERE action = 'approved')::text AS approvals,
        COUNT(*) FILTER (WHERE action = 'rejected')::text AS rejects
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
            WHEN al.action = 'admin_moderation_approve' THEN 'approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'rejected'
            WHEN al.action = 'admin_override_score' THEN 'edited_score'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') IN ('submitted', 'review', 'needs_revision') THEN 'reopened'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'approved' THEN 'approved'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'rejected' THEN 'rejected'
            WHEN al.action = 'login' THEN 'login'
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
            WHEN al.action = 'admin_moderation_approve' THEN 'approved'
            WHEN al.action = 'admin_moderation_reject' THEN 'rejected'
            WHEN al.action = 'admin_override_score' THEN 'edited_score'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') IN ('submitted', 'review', 'needs_revision') THEN 'reopened'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'approved' THEN 'approved'
            WHEN al.action = 'admin_override_status'
              AND COALESCE(al.new_values->>'status', '') = 'rejected' THEN 'rejected'
            WHEN al.action = 'login' THEN 'login'
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

  async countSubmissions(query: AdminSubmissionsQuery): Promise<number> {
    const { whereSql, params } = buildAdminSubmissionFilters(query);

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

  async listSubmissions(query: AdminSubmissionsQuery): Promise<AdminSubmissionListRow[]> {
    const { whereSql, params } = buildAdminSubmissionFilters(query);
    const offset = (query.page - 1) * query.pageSize;

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
        s.created_at,
        COALESCE(s.submitted_at, s.created_at) AS submitted_at,
        CASE
          WHEN s.status IN ('approved', 'rejected') THEN s.total_score::text
          ELSE NULL
        END AS score,
        first_item.category_code,
        first_item.category_title,
        first_item.subcategory_slug,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS owner_name
      FROM public.submissions s
      LEFT JOIN public.users u ON u.id = s.user_id
      LEFT JOIN LATERAL (
        SELECT
          c.code AS category_code,
          cs.slug AS subcategory_slug,
          COALESCE(
            NULLIF(btrim(c.title::text), ''),
            initcap(regexp_replace(c.name, '_', ' ', 'g'))
          ) AS category_title
        FROM public.submission_items si
        LEFT JOIN public.categories c ON c.id = si.category_id
        LEFT JOIN public.category_subcategories cs ON cs.id = si.subcategory_id
        WHERE si.submission_id = s.id
        ORDER BY si.created_at ASC
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
    const result = await db.query<AdminUserRow>(
      `
      SELECT
        student_full_name,
        faculty,
        student_id,
        telegram_username
      FROM public.users
      WHERE id = $1
      `,
      [userId],
    );

    return result.rows[0] ?? null;
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
        si.status::text AS status,
        c.code AS category_code,
        c.name AS category_name,
        COALESCE(
          NULLIF(btrim(c.title::text), ''),
          initcap(regexp_replace(c.name, '_', ' ', 'g'))
        ) AS category_title,
        cs.slug AS subcategory_slug,
        cs.label AS subcategory_label,
        si.created_at,
        si.updated_at
      FROM public.submission_items si
      LEFT JOIN public.submissions s ON s.id = si.submission_id
      LEFT JOIN public.categories c ON c.id = si.category_id
      LEFT JOIN public.category_subcategories cs ON cs.id = si.subcategory_id
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
      const res = await client.query(
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
    const result = await client.query<AdminSubmissionDetailRow>(
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

    const row = result.rows[0];
    if (!row) {
      throw new ServiceError(500, "Failed to finalize submission", "FINALIZE_FAILED");
    }
    return row;
  }
}
