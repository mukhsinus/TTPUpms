import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { ServiceError } from "../../utils/service-error";
import type { AdminModerationStatus, AdminSubmissionsQuery } from "./admin.schema";

export interface AdminSubmissionListRow {
  id: string;
  user_id: string;
  title: string;
  db_status: string;
  created_at: string;
  proposed_score: string | null;
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

function sortColumn(sort: AdminSubmissionsQuery["sort"]): string {
  if (sort === "title") {
    return "s.title";
  }
  if (sort === "status") {
    return "s.status";
  }
  if (sort === "score") {
    return "proposed_score_sort";
  }
  return "s.created_at";
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
        WHERE si2.submission_id = s.id AND c2.code = $${p}
      )
    `);
    params.push(query.category);
    p += 1;
  }
  if (query.dateFrom) {
    conditions.push(`s.created_at >= $${p}::timestamptz`);
    params.push(query.dateFrom);
    p += 1;
  }
  if (query.dateTo) {
    conditions.push(`s.created_at <= $${p}::timestamptz`);
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
        `(s.title ILIKE $${p} ESCAPE '\\' OR COALESCE(u.student_full_name::text, u.full_name::text, '') ILIKE $${p} ESCAPE '\\')`,
      );
      params.push(pattern);
      p += 1;
    }
  }

  return { whereSql: `WHERE ${conditions.join(" AND ")}`, params };
}

export class AdminRepository {
  constructor(private readonly app: FastifyInstance) {}

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
    const orderCol = sortColumn(query.sort);
    const orderDir = query.order === "asc" ? "ASC" : "DESC";
    const offset = (query.page - 1) * query.pageSize;

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    params.push(query.pageSize, offset);

    const result = await this.app.db.query<AdminSubmissionListRow>(
      `
      SELECT
        s.id,
        s.user_id,
        s.title,
        s.status::text AS db_status,
        s.created_at,
        first_item.proposed_score::text AS proposed_score,
        first_item.category_code,
        first_item.category_title,
        first_item.subcategory_slug,
        u.student_full_name AS owner_name,
        COALESCE(first_item.proposed_score, 0) AS proposed_score_sort
      FROM public.submissions s
      LEFT JOIN public.users u ON u.id = s.user_id
      LEFT JOIN LATERAL (
        SELECT
          si.proposed_score,
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
      ORDER BY ${orderCol} ${orderDir}, s.id ASC
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
        (SELECT s.user_id::text FROM public.submissions s WHERE s.id = si.submission_id LIMIT 1) AS submission_user_id,
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
