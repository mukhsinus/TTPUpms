import type { FastifyInstance } from "fastify";
import type { SuperadminAuditQuery, SuperadminListQuery, SuperadminSecurityQuery } from "./superadmin.schema";
import type { AdminActivityAction } from "../audit/admin-activity";

export interface SuperadminAdminListRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "admin" | "superadmin";
  status: "active" | "suspended";
  created_at: string;
  last_login_at: string | null;
  last_login_ip: string | null;
  approvals: string;
  rejects: string;
  avg_review_minutes: string | null;
}

export interface SuperadminAuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  submission_title: string | null;
  metadata: Record<string, unknown> | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  request_ip: string | null;
}

export interface SuperadminSecurityEventRow {
  id: string;
  admin_id: string;
  admin_name: string | null;
  admin_email: string | null;
  type: "new_device_login" | "logout_others_request" | "admin_registration";
  status: "pending" | "approved" | "rejected";
  metadata: Record<string, unknown> | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuperadminDetailIdentityRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "admin" | "superadmin";
  status: "active" | "suspended";
  created_at: string;
  suspended_at: string | null;
  suspension_reason: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
}

export interface SuperadminDetailStatsRow {
  approvals: string;
  rejects: string;
  avg_review_minutes: string | null;
}

export interface SuperadminSimpleActivityRow {
  id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
  created_at: string;
}

export interface SuperadminSessionRow {
  id: string;
  session_token: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface SuperadminAdminNoteRow {
  id: string;
  submission_id: string;
  admin_id: string;
  admin_name: string | null;
  note: string;
  created_at: string;
}

export interface ActivityReportRow {
  time: string;
  admin_name: string | null;
  admin_email: string | null;
  action_type: string;
  entity_type: string | null;
  entity_label: string;
  details: string;
}

export interface SuperadminPendingAdminRegistrationRow {
  event_id: string;
  admin_id: string;
  admin_name: string | null;
  admin_email: string | null;
  created_at: string;
}

export class SuperadminRepository {
  private static readonly HIDDEN_ADMIN_EMAILS = [
    "kamolovmuhsin@icloud.com",
    "kamolovmuhsin@iclod.com",
  ];
  private static readonly AUDIT_ALLOWED_ACTIONS = [
    "project_phase_changed",
    "moderation_submission_approved",
    "moderation_submission_rejected",
    "student_profile_updated",
  ];

  constructor(private readonly app: FastifyInstance) {}

  private hiddenEmailWhere(emailSqlExpr: string, includeHidden: boolean): string {
    if (includeHidden) {
      return "1=1";
    }
    const hiddenList = SuperadminRepository.HIDDEN_ADMIN_EMAILS.map((email) => `'${email}'`).join(", ");
    return `COALESCE(LOWER(${emailSqlExpr}), '') NOT IN (${hiddenList})`;
  }

  async getSuperDashboardSummary(includeHidden = false): Promise<{
    pending_queue: string;
    processed_7d: string;
    avg_review_minutes: string | null;
    active_admins_today: string;
    security_alerts_count: string;
  }> {
    const result = await this.app.db.query<{
      pending_queue: string;
      processed_7d: string;
      avg_review_minutes: string | null;
      active_admins_today: string;
      security_alerts_count: string;
    }>(
      `
      SELECT
        (
          SELECT COUNT(*)::text
          FROM public.submissions s
          WHERE s.status IN ('submitted', 'review', 'needs_revision')
        ) AS pending_queue,
        (
          SELECT COUNT(*)::text
          FROM public.submissions s
          WHERE s.status IN ('approved', 'rejected')
            AND s.reviewed_at >= NOW() - INTERVAL '7 days'
        ) AS processed_7d,
        (
          SELECT ROUND(AVG(EXTRACT(EPOCH FROM (s.reviewed_at - s.created_at)) / 60.0)::numeric, 2)::text
          FROM public.submissions s
          WHERE s.status IN ('approved', 'rejected')
            AND s.reviewed_at IS NOT NULL
        ) AS avg_review_minutes,
        (
          SELECT COUNT(DISTINCT al.user_id)::text
          FROM public.audit_logs al
          INNER JOIN public.admin_users au ON au.id = al.user_id
          INNER JOIN public.users u ON u.id = au.id
          WHERE al.action = 'login'
            AND al.created_at >= date_trunc('day', NOW())
            AND ${this.hiddenEmailWhere("u.email::text", includeHidden)}
        ) AS active_admins_today,
        (
          SELECT COUNT(*)::text
          FROM public.admin_security_events ase
          INNER JOIN public.users u ON u.id = ase.admin_id
          WHERE ase.status = 'pending'
            AND ${this.hiddenEmailWhere("u.email::text", includeHidden)}
        ) AS security_alerts_count
      `,
    );
    return (
      result.rows[0] ?? {
        pending_queue: "0",
        processed_7d: "0",
        avg_review_minutes: "0",
        active_admins_today: "0",
        security_alerts_count: "0",
      }
    );
  }

  async listPendingAdminRegistrationRequests(
    limit = 5,
    includeHidden = false,
  ): Promise<SuperadminPendingAdminRegistrationRow[]> {
    const result = await this.app.db.query<SuperadminPendingAdminRegistrationRow>(
      `
      SELECT DISTINCT ON (ase.admin_id)
        ase.id::text AS event_id,
        ase.admin_id::text AS admin_id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS admin_name,
        u.email::text AS admin_email,
        ase.created_at
      FROM public.admin_security_events ase
      INNER JOIN public.users u ON u.id = ase.admin_id
      WHERE ase.type = 'admin_registration'
        AND ase.status = 'pending'
        AND ${this.hiddenEmailWhere("u.email::text", includeHidden)}
      ORDER BY ase.admin_id, ase.created_at DESC
      LIMIT $1::int
      `,
      [limit],
    );
    return result.rows;
  }

  async countAdmins(query: SuperadminListQuery, includeHidden = false): Promise<number> {
    const search = query.search?.trim();
    const params: unknown[] = [];
    let where = `WHERE ${this.hiddenEmailWhere("u.email::text", includeHidden)}`;
    if (search) {
      params.push(`%${search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
      where += ` AND (u.email::text ILIKE $1 ESCAPE '\\' OR COALESCE(u.full_name, '') ILIKE $1 ESCAPE '\\')`;
    }
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM public.admin_users au
      INNER JOIN public.users u ON u.id = au.id
      ${where}
      `,
      params,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listAdmins(query: SuperadminListQuery, includeHidden = false): Promise<SuperadminAdminListRow[]> {
    const search = query.search?.trim();
    const params: unknown[] = [];
    const offset = (query.page - 1) * query.pageSize;
    let where = `WHERE ${this.hiddenEmailWhere("u.email::text", includeHidden)}`;
    let paramIndex = 1;
    if (search) {
      params.push(`%${search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
      where += ` AND (u.email::text ILIKE $${paramIndex} ESCAPE '\\' OR COALESCE(u.full_name, '') ILIKE $${paramIndex} ESCAPE '\\')`;
      paramIndex += 1;
    }
    params.push(query.pageSize, offset);
    const limitParam = `$${paramIndex}`;
    const offsetParam = `$${paramIndex + 1}`;
    const result = await this.app.db.query<SuperadminAdminListRow>(
      `
      SELECT
        au.id::text AS id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS full_name,
        u.email::text AS email,
        au.role::text AS role,
        au.status::text AS status,
        au.created_at,
        au.last_login_at,
        au.last_login_ip,
        COUNT(*) FILTER (WHERE s.reviewed_by = au.id AND s.status = 'approved')::text AS approvals,
        COUNT(*) FILTER (WHERE s.reviewed_by = au.id AND s.status = 'rejected')::text AS rejects,
        (
          ROUND(
            AVG(EXTRACT(EPOCH FROM (s.reviewed_at - s.created_at)) / 60.0)
            FILTER (WHERE s.reviewed_by = au.id AND s.reviewed_at IS NOT NULL AND s.status IN ('approved', 'rejected'))::numeric,
            2
          )::text
        ) AS avg_review_minutes
      FROM public.admin_users au
      INNER JOIN public.users u ON u.id = au.id
      LEFT JOIN public.submissions s ON s.reviewed_by = au.id
      ${where}
      GROUP BY au.id, u.student_full_name, u.full_name, u.email, au.role, au.status, au.created_at, au.last_login_at, au.last_login_ip
      ORDER BY au.role DESC, au.created_at DESC
      LIMIT ${limitParam}::int OFFSET ${offsetParam}::int
      `,
      params,
    );
    return result.rows;
  }

  async findAdminIdentity(adminId: string, includeHidden = false): Promise<SuperadminDetailIdentityRow | null> {
    const result = await this.app.db.query<SuperadminDetailIdentityRow>(
      `
      SELECT
        au.id::text AS id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS full_name,
        u.email::text AS email,
        au.role::text AS role,
        au.status::text AS status,
        au.created_at,
        au.suspended_at,
        au.suspension_reason,
        au.last_login_at,
        au.last_login_ip
      FROM public.admin_users au
      INNER JOIN public.users u ON u.id = au.id
      WHERE au.id = $1::uuid
        AND ${this.hiddenEmailWhere("u.email::text", includeHidden)}
      LIMIT 1
      `,
      [adminId],
    );
    return result.rows[0] ?? null;
  }

  async getAdminStats(adminId: string): Promise<SuperadminDetailStatsRow> {
    const result = await this.app.db.query<SuperadminDetailStatsRow>(
      `
      SELECT
        COUNT(*) FILTER (WHERE s.reviewed_by = $1::uuid AND s.status = 'approved')::text AS approvals,
        COUNT(*) FILTER (WHERE s.reviewed_by = $1::uuid AND s.status = 'rejected')::text AS rejects,
        (
          ROUND(
            AVG(EXTRACT(EPOCH FROM (s.reviewed_at - s.created_at)) / 60.0)
            FILTER (WHERE s.reviewed_by = $1::uuid AND s.reviewed_at IS NOT NULL AND s.status IN ('approved', 'rejected'))::numeric,
            2
          )::text
        ) AS avg_review_minutes
      FROM public.submissions s
      `,
      [adminId],
    );
    return result.rows[0] ?? { approvals: "0", rejects: "0", avg_review_minutes: "0" };
  }

  async listAdminRecentActivity(adminId: string, page: number, pageSize: number): Promise<SuperadminSimpleActivityRow[]> {
    const offset = (page - 1) * pageSize;
    const result = await this.app.db.query<SuperadminSimpleActivityRow>(
      `
      SELECT
        al.id::text AS id,
        al.action,
        al.entity_table AS target_table,
        al.entity_id::text AS target_id,
        al.created_at
      FROM public.audit_logs al
      WHERE al.user_id = $1::uuid
      ORDER BY al.created_at DESC
      LIMIT $2::int OFFSET $3::int
      `,
      [adminId, pageSize, offset],
    );
    return result.rows;
  }

  async countAdminRecentActivity(adminId: string): Promise<number> {
    const result = await this.app.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.audit_logs WHERE user_id = $1::uuid`,
      [adminId],
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listAdminSessions(adminId: string): Promise<SuperadminSessionRow[]> {
    const result = await this.app.db.query<SuperadminSessionRow>(
      `
      SELECT
        id::text AS id,
        session_token,
        ip,
        user_agent,
        created_at,
        last_seen_at,
        revoked_at
      FROM public.admin_sessions
      WHERE admin_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [adminId],
    );
    return result.rows;
  }

  async countSuperadmins(): Promise<number> {
    const result = await this.app.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM public.admin_users WHERE role::text = 'superadmin'`,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async updateAdminRole(adminId: string, role: "admin" | "superadmin"): Promise<void> {
    await this.app.db.query(
      `
      UPDATE public.admin_users
      SET role = $2::public.user_role
      WHERE id = $1::uuid
      `,
      [adminId, role],
    );
    await this.app.db.query(
      `
      UPDATE public.users
      SET role = $2::public.user_role, updated_at = NOW()
      WHERE id = $1::uuid
      `,
      [adminId, role],
    );
  }

  async updateAdminStatus(
    adminId: string,
    input: { status: "active" | "suspended"; suspendedBy: string; reason?: string },
  ): Promise<void> {
    await this.app.db.query(
      `
      UPDATE public.admin_users
      SET
        status = $2::public.admin_account_status,
        suspended_at = CASE WHEN $2 = 'suspended' THEN NOW() ELSE NULL END,
        suspended_by = CASE WHEN $2 = 'suspended' THEN $3::uuid ELSE NULL END,
        suspension_reason = CASE WHEN $2 = 'suspended' THEN NULLIF($4, '') ELSE NULL END
      WHERE id = $1::uuid
      `,
      [adminId, input.status, input.suspendedBy, input.reason ?? null],
    );
  }

  async updateAdminLastLogin(adminId: string, ip: string | null): Promise<void> {
    await this.app.db.query(
      `
      UPDATE public.admin_users
      SET last_login_at = NOW(), last_login_ip = COALESCE($2, last_login_ip)
      WHERE id = $1::uuid
      `,
      [adminId, ip],
    );
  }

  async findAdminEmail(adminId: string): Promise<string | null> {
    const result = await this.app.db.query<{ email: string | null }>(
      `SELECT email::text AS email FROM public.users WHERE id = $1::uuid LIMIT 1`,
      [adminId],
    );
    return result.rows[0]?.email ?? null;
  }

  async countAuditLogs(query: SuperadminAuditQuery, includeHidden = false): Promise<number> {
    const { whereSql, params } = this.buildAuditFilter(query, includeHidden);
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM public.audit_logs al
      INNER JOIN public.admin_users au ON au.id = al.user_id
      LEFT JOIN public.users u ON u.id = al.user_id
      ${whereSql}
      `,
      params,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listAuditLogs(query: SuperadminAuditQuery, includeHidden = false): Promise<SuperadminAuditRow[]> {
    const { whereSql, params } = this.buildAuditFilter(query, includeHidden);
    const offset = (query.page - 1) * query.pageSize;
    const withPaging = [...params, query.pageSize, offset];
    const limitPos = withPaging.length - 1;
    const offsetPos = withPaging.length;
    const result = await this.app.db.query<SuperadminAuditRow>(
      `
      SELECT
        al.id::text AS id,
        al.created_at,
        al.user_id::text AS actor_id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), ''), 'System') AS actor_name,
        u.email::text AS actor_email,
        al.action,
        al.entity_table AS target_table,
        al.entity_id::text AS target_id,
        COALESCE(al.metadata->>'submissionTitle', s.title) AS submission_title,
        al.metadata,
        al.old_values,
        al.new_values,
        al.request_ip::text AS request_ip
      FROM public.audit_logs al
      INNER JOIN public.admin_users au ON au.id = al.user_id
      LEFT JOIN public.users u ON u.id = al.user_id
      LEFT JOIN public.submissions s ON al.entity_table = 'submissions' AND al.entity_id::text = s.id::text
      ${whereSql}
      ORDER BY al.created_at DESC
      LIMIT $${limitPos}::int OFFSET $${offsetPos}::int
      `,
      withPaging,
    );
    return result.rows;
  }

  private buildAuditFilter(query: SuperadminAuditQuery, includeHidden: boolean): { whereSql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    where.push(
      `al.action = ANY(ARRAY[${SuperadminRepository.AUDIT_ALLOWED_ACTIONS.map((action) => `'${action}'`).join(", ")}])`,
    );
    if (!includeHidden) {
      where.push(this.hiddenEmailWhere("u.email::text", false));
    }
    if (query.adminId) {
      where.push(`al.user_id = $${i++}::uuid`);
      params.push(query.adminId);
    }
    if (query.action) {
      where.push(`al.action = $${i++}`);
      params.push(query.action);
    }
    if (query.dateFrom) {
      where.push(`al.created_at >= $${i++}::timestamptz`);
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      where.push(`al.created_at <= $${i++}::timestamptz`);
      params.push(query.dateTo);
    }
    if (query.search?.trim()) {
      where.push(
        `(
          COALESCE(u.email::text, '') ILIKE $${i}
          OR COALESCE(u.student_full_name, '') ILIKE $${i}
          OR COALESCE(u.full_name, '') ILIKE $${i}
        )`,
      );
      params.push(`%${query.search.trim()}%`);
      i += 1;
    }
    return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
  }

  async countSecurityEvents(query: SuperadminSecurityQuery, includeHidden = false): Promise<number> {
    const { whereSql, params } = this.buildSecurityFilter(query, includeHidden);
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM public.admin_security_events ase
      INNER JOIN public.users u ON u.id = ase.admin_id
      ${whereSql}
      `,
      params,
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async listSecurityEvents(query: SuperadminSecurityQuery, includeHidden = false): Promise<SuperadminSecurityEventRow[]> {
    const { whereSql, params } = this.buildSecurityFilter(query, includeHidden);
    const offset = (query.page - 1) * query.pageSize;
    const result = await this.app.db.query<SuperadminSecurityEventRow>(
      `
      SELECT
        ase.id::text AS id,
        ase.admin_id::text AS admin_id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS admin_name,
        u.email::text AS admin_email,
        ase.type,
        ase.status,
        ase.metadata,
        ase.approved_by::text AS approved_by,
        ase.approved_at,
        ase.created_at,
        ase.updated_at
      FROM public.admin_security_events ase
      INNER JOIN public.users u ON u.id = ase.admin_id
      ${whereSql}
      ORDER BY ase.created_at DESC
      LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int
      `,
      [...params, query.pageSize, offset],
    );
    return result.rows;
  }

  private buildSecurityFilter(query: SuperadminSecurityQuery, includeHidden: boolean): { whereSql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (!includeHidden) {
      where.push(this.hiddenEmailWhere("u.email::text", false));
    }
    if (query.status) {
      where.push(`ase.status = $${i++}`);
      params.push(query.status);
    }
    if (query.type) {
      where.push(`ase.type = $${i++}`);
      params.push(query.type);
    }
    if (query.adminId) {
      where.push(`ase.admin_id = $${i++}::uuid`);
      params.push(query.adminId);
    }
    return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
  }

  async resolveSecurityEvent(
    eventId: string,
    status: "approved" | "rejected",
    approvedBy: string,
  ): Promise<boolean> {
    const result = await this.app.db.query(
      `
      UPDATE public.admin_security_events
      SET
        status = $2,
        approved_by = $3::uuid,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND status = 'pending'
      `,
      [eventId, status, approvedBy],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeSessionsForAdmin(adminId: string): Promise<number> {
    const result = await this.app.db.query(
      `
      UPDATE public.admin_sessions
      SET revoked_at = NOW(), last_seen_at = NOW()
      WHERE admin_id = $1::uuid
        AND revoked_at IS NULL
      `,
      [adminId],
    );
    return result.rowCount ?? 0;
  }

  async assignSubmission(submissionId: string, adminId: string): Promise<void> {
    await this.app.db.query(
      `
      UPDATE public.submissions
      SET assigned_admin_id = $2::uuid, updated_at = NOW()
      WHERE id = $1::uuid
      `,
      [submissionId, adminId],
    );
  }

  async addAdminNote(submissionId: string, adminId: string, note: string): Promise<void> {
    await this.app.db.query(
      `
      INSERT INTO public.admin_notes (submission_id, admin_id, note)
      VALUES ($1::uuid, $2::uuid, $3)
      `,
      [submissionId, adminId, note],
    );
  }

  async listAdminNotes(submissionId: string): Promise<SuperadminAdminNoteRow[]> {
    const result = await this.app.db.query<SuperadminAdminNoteRow>(
      `
      SELECT
        n.id::text AS id,
        n.submission_id::text AS submission_id,
        n.admin_id::text AS admin_id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS admin_name,
        n.note,
        n.created_at
      FROM public.admin_notes n
      LEFT JOIN public.users u ON u.id = n.admin_id
      WHERE n.submission_id = $1::uuid
      ORDER BY n.created_at DESC
      `,
      [submissionId],
    );
    return result.rows;
  }

  async getModerationReportRows(from: string, to: string): Promise<Array<Record<string, string | number | null>>> {
    const result = await this.app.db.query<{
      day: string;
      approved_count: string;
      rejected_count: string;
      avg_review_minutes: string | null;
    }>(
      `
      SELECT
        to_char(date_trunc('day', s.reviewed_at), 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE s.status = 'approved')::text AS approved_count,
        COUNT(*) FILTER (WHERE s.status = 'rejected')::text AS rejected_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (s.reviewed_at - s.created_at)) / 60.0)::numeric, 2)::text AS avg_review_minutes
      FROM public.submissions s
      WHERE s.reviewed_at >= $1::timestamptz
        AND s.reviewed_at <= $2::timestamptz
        AND s.status IN ('approved', 'rejected')
      GROUP BY date_trunc('day', s.reviewed_at)
      ORDER BY date_trunc('day', s.reviewed_at) ASC
      `,
      [from, to],
    );
    return result.rows.map((r) => ({
      day: r.day,
      approvedCount: Number(r.approved_count),
      rejectedCount: Number(r.rejected_count),
      avgReviewMinutes: r.avg_review_minutes !== null ? Number(r.avg_review_minutes) : null,
    }));
  }

  async getAdminProductivityRows(
    from: string,
    to: string,
    includeHidden = false,
  ): Promise<Array<Record<string, string | number | null>>> {
    const result = await this.app.db.query<{
      admin_id: string;
      admin_name: string | null;
      admin_email: string | null;
      approvals: string;
      rejects: string;
      total_actions: string;
    }>(
      `
      SELECT
        au.id::text AS admin_id,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS admin_name,
        u.email::text AS admin_email,
        COUNT(*) FILTER (WHERE al.action = 'admin_moderation_approve')::text AS approvals,
        COUNT(*) FILTER (WHERE al.action = 'admin_moderation_reject')::text AS rejects,
        COUNT(*)::text AS total_actions
      FROM public.audit_logs al
      INNER JOIN public.admin_users au ON au.id = al.user_id
      LEFT JOIN public.users u ON u.id = au.id
      WHERE al.created_at >= $1::timestamptz
        AND al.created_at <= $2::timestamptz
        AND ${this.hiddenEmailWhere("u.email::text", includeHidden)}
      GROUP BY au.id, u.student_full_name, u.full_name, u.email
      ORDER BY COUNT(*) DESC, au.id ASC
      `,
      [from, to],
    );
    return result.rows.map((r) => ({
      adminId: r.admin_id,
      adminName: r.admin_name,
      adminEmail: r.admin_email,
      approvals: Number(r.approvals),
      rejects: Number(r.rejects),
      totalActions: Number(r.total_actions),
    }));
  }

  async getApprovalSummaryRows(from: string, to: string): Promise<Array<Record<string, string | number>>> {
    const result = await this.app.db.query<{
      status: string;
      count: string;
    }>(
      `
      SELECT s.status::text AS status, COUNT(*)::text AS count
      FROM public.submissions s
      WHERE s.reviewed_at >= $1::timestamptz
        AND s.reviewed_at <= $2::timestamptz
        AND s.status IN ('approved', 'rejected', 'needs_revision')
      GROUP BY s.status
      ORDER BY s.status ASC
      `,
      [from, to],
    );
    return result.rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  async getAuditExportRows(from: string, to: string, includeHidden = false): Promise<Array<Record<string, string | null>>> {
    const result = await this.app.db.query<{
      time: string;
      actor_email: string | null;
      action: string;
      target_table: string | null;
      target_id: string | null;
      request_ip: string | null;
    }>(
      `
      SELECT
        to_char(al.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS time,
        u.email::text AS actor_email,
        al.action,
        al.entity_table AS target_table,
        al.entity_id::text AS target_id,
        al.request_ip::text AS request_ip
      FROM public.audit_logs al
      INNER JOIN public.admin_users au ON au.id = al.user_id
      LEFT JOIN public.users u ON u.id = al.user_id
      WHERE al.created_at >= $1::timestamptz
        AND al.created_at <= $2::timestamptz
        AND ${this.hiddenEmailWhere("u.email::text", includeHidden)}
      ORDER BY al.created_at DESC
      `,
      [from, to],
    );
    return result.rows.map((r) => ({
      time: r.time,
      actorEmail: r.actor_email,
      action: r.action,
      targetTable: r.target_table,
      targetId: r.target_id,
      requestIp: r.request_ip,
    }));
  }

  async listActivityReportRows(input: {
    from: string;
    to: string;
    adminId?: string;
    actionType?: AdminActivityAction;
    includeHidden?: boolean;
  }): Promise<ActivityReportRow[]> {
    const params: unknown[] = [input.from, input.to];
    const where: string[] = [
      "aal.created_at >= $1::timestamptz",
      "aal.created_at <= $2::timestamptz",
    ];
    if (!input.includeHidden) {
      where.push(this.hiddenEmailWhere("aal.admin_email::text", false));
    }
    let paramIndex = 3;
    if (input.adminId) {
      where.push(`aal.admin_id = $${paramIndex++}::uuid`);
      params.push(input.adminId);
    }
    if (input.actionType) {
      where.push(`aal.action_type = $${paramIndex++}`);
      params.push(input.actionType);
    }
    const result = await this.app.db.query<ActivityReportRow>(
      `
      SELECT
        to_char(aal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS time,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS admin_name,
        aal.admin_email::text AS admin_email,
        aal.action_type,
        aal.entity_type,
        aal.entity_label,
        CONCAT(
          COALESCE(NULLIF(aal.old_value::text, '{}'), ''),
          CASE
            WHEN aal.old_value::text <> '{}'::text AND aal.new_value::text <> '{}'::text THEN ' -> '
            ELSE ''
          END,
          COALESCE(NULLIF(aal.new_value::text, '{}'), '')
        ) AS details
      FROM public.admin_activity_logs aal
      LEFT JOIN public.users u ON u.id = aal.admin_id
      WHERE ${where.join(" AND ")}
      ORDER BY aal.created_at DESC, aal.id DESC
      `,
      params,
    );
    return result.rows;
  }
}
