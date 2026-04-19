import type { FastifyInstance } from "fastify";

export interface AdminProfileIdentityRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "superadmin";
  joined_at: string | null;
  admin_code: string;
  last_login_at: string | null;
  last_login_ip: string | null;
  last_login_user_agent: string | null;
}

export interface AdminProfileStatsRow {
  approvals: string;
  rejects: string;
  avg_review_minutes: string | null;
  actions_7d: string;
}

export interface AdminProfileRecentActionRow {
  id: string;
  action: "approved" | "rejected" | "edited_score" | "reopened" | "login";
  student_id: string | null;
  submission_id: string | null;
  submission_title: string | null;
  created_at: string;
}

export interface AdminSessionRow {
  id: string;
  session_token: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface AdminSecurityEventRow {
  id: string;
  type: "new_device_login" | "logout_others_request" | "admin_registration";
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export class AdminProfileRepository {
  private ensureSchemaPromise: Promise<void> | null = null;

  constructor(private readonly app: FastifyInstance) {}

  private async ensureSchema(): Promise<void> {
    if (!this.ensureSchemaPromise) {
      this.ensureSchemaPromise = (async () => {
        await this.app.db.query(`
          CREATE TABLE IF NOT EXISTS public.admin_sessions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
            session_token text NOT NULL UNIQUE,
            device_fingerprint text NOT NULL,
            ip text NULL,
            user_agent text NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now(),
            revoked_at timestamptz NULL
          )
        `);
        await this.app.db.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_last_seen
          ON public.admin_sessions (admin_id, last_seen_at DESC)
        `);
        await this.app.db.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_active
          ON public.admin_sessions (admin_id)
          WHERE revoked_at IS NULL
        `);
        await this.app.db.query(`
          CREATE TABLE IF NOT EXISTS public.admin_security_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
            type text NOT NULL,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            status text NOT NULL DEFAULT 'pending',
            approved_by uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
            approved_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT admin_security_events_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
            CONSTRAINT admin_security_events_type_check CHECK (
              type IN ('new_device_login', 'logout_others_request', 'admin_registration')
            )
          )
        `);
        await this.app.db.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_security_events_admin_created
          ON public.admin_security_events (admin_id, created_at DESC)
        `);
        await this.app.db.query(`
          CREATE INDEX IF NOT EXISTS idx_admin_security_events_pending
          ON public.admin_security_events (status, type, created_at DESC)
          WHERE status = 'pending'
        `);
      })();
    }
    await this.ensureSchemaPromise;
  }

  async findIdentity(adminId: string): Promise<AdminProfileIdentityRow | null> {
    await this.ensureSchema();
    const result = await this.app.db.query<AdminProfileIdentityRow>(
      `
      WITH ranked_admins AS (
        SELECT
          au.id,
          au.created_at,
          ROW_NUMBER() OVER (ORDER BY au.created_at ASC, au.id ASC) AS seq
        FROM public.admin_users au
      ),
      last_login AS (
        SELECT
          al.user_id,
          al.created_at,
          al.request_ip,
          al.user_agent
        FROM public.audit_logs al
        WHERE al.user_id = $1::uuid
          AND al.action = 'login'
        ORDER BY al.created_at DESC
        LIMIT 1
      )
      SELECT
        u.id::text AS id,
        u.email::text AS email,
        COALESCE(NULLIF(BTRIM(u.student_full_name), ''), NULLIF(BTRIM(u.full_name), '')) AS full_name,
        au.role::text AS role,
        ra.created_at AS joined_at,
        ('ADM-' || LPAD(ra.seq::text, 3, '0')) AS admin_code,
        ll.created_at AS last_login_at,
        ll.request_ip AS last_login_ip,
        ll.user_agent AS last_login_user_agent
      FROM public.admin_users au
      INNER JOIN public.users u ON u.id = au.id
      LEFT JOIN ranked_admins ra ON ra.id = au.id
      LEFT JOIN last_login ll ON ll.user_id = au.id
      WHERE au.id = $1::uuid
      LIMIT 1
      `,
      [adminId],
    );
    return result.rows[0] ?? null;
  }

  async getStats(adminId: string): Promise<AdminProfileStatsRow> {
    await this.ensureSchema();
    const result = await this.app.db.query<AdminProfileStatsRow>(
      `
      WITH activity AS (
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
          END AS action,
          al.created_at
        FROM public.audit_logs al
        WHERE al.user_id = $1::uuid
      )
      SELECT
        COUNT(*) FILTER (WHERE action = 'approved')::text AS approvals,
        COUNT(*) FILTER (WHERE action = 'rejected')::text AS rejects,
        (
          SELECT ROUND(AVG(EXTRACT(EPOCH FROM (s.reviewed_at - s.created_at)) / 60.0)::numeric, 2)::text
          FROM public.submissions s
          WHERE s.reviewed_by = $1::uuid
            AND s.reviewed_at IS NOT NULL
            AND s.status IN ('approved', 'rejected')
        ) AS avg_review_minutes,
        COUNT(*) FILTER (
          WHERE action IS NOT NULL
            AND created_at >= NOW() - INTERVAL '7 days'
        )::text AS actions_7d
      FROM activity
      WHERE action IS NOT NULL
      `,
      [adminId],
    );
    return (
      result.rows[0] ?? {
        approvals: "0",
        rejects: "0",
        avg_review_minutes: "0",
        actions_7d: "0",
      }
    );
  }

  async countRecentActions(adminId: string): Promise<number> {
    await this.ensureSchema();
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

  async listRecentActions(adminId: string, page: number, pageSize: number): Promise<AdminProfileRecentActionRow[]> {
    await this.ensureSchema();
    const offset = (page - 1) * pageSize;
    const result = await this.app.db.query<AdminProfileRecentActionRow>(
      `
      WITH base AS (
        SELECT
          al.id::text AS id,
          su.student_id::text AS student_id,
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
      SELECT id, action, student_id, submission_id, submission_title, created_at
      FROM base
      WHERE action IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $2::int OFFSET $3::int
      `,
      [adminId, pageSize, offset],
    );
    return result.rows;
  }

  async findSession(adminId: string, sessionToken: string): Promise<AdminSessionRow | null> {
    await this.ensureSchema();
    const result = await this.app.db.query<AdminSessionRow>(
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
        AND session_token = $2
      LIMIT 1
      `,
      [adminId, sessionToken],
    );
    return result.rows[0] ?? null;
  }

  async hasKnownFingerprint(adminId: string, fingerprint: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.app.db.query<{ id: string }>(
      `
      SELECT id::text AS id
      FROM public.admin_sessions
      WHERE admin_id = $1::uuid
        AND device_fingerprint = $2
      LIMIT 1
      `,
      [adminId, fingerprint],
    );
    return Boolean(result.rows[0]);
  }

  async createSession(input: {
    adminId: string;
    sessionToken: string;
    fingerprint: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.ensureSchema();
    await this.app.db.query(
      `
      INSERT INTO public.admin_sessions (
        admin_id,
        session_token,
        device_fingerprint,
        ip,
        user_agent,
        created_at,
        last_seen_at
      )
      VALUES ($1::uuid, $2, $3, $4, $5, NOW(), NOW())
      `,
      [input.adminId, input.sessionToken, input.fingerprint, input.ip, input.userAgent],
    );
  }

  async touchSession(adminId: string, sessionToken: string, ip: string | null, userAgent: string | null): Promise<void> {
    await this.ensureSchema();
    await this.app.db.query(
      `
      UPDATE public.admin_sessions
      SET
        last_seen_at = NOW(),
        ip = $3,
        user_agent = $4
      WHERE admin_id = $1::uuid
        AND session_token = $2
        AND revoked_at IS NULL
      `,
      [adminId, sessionToken, ip, userAgent],
    );
  }

  async listSessions(adminId: string): Promise<AdminSessionRow[]> {
    await this.ensureSchema();
    const result = await this.app.db.query<AdminSessionRow>(
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
      ORDER BY
        CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END ASC,
        last_seen_at DESC
      LIMIT 20
      `,
      [adminId],
    );
    return result.rows;
  }

  async revokeCurrentSession(adminId: string, sessionToken: string): Promise<void> {
    await this.ensureSchema();
    await this.app.db.query(
      `
      UPDATE public.admin_sessions
      SET revoked_at = NOW()
      WHERE admin_id = $1::uuid
        AND session_token = $2
        AND revoked_at IS NULL
      `,
      [adminId, sessionToken],
    );
  }

  async revokeOtherSessions(adminId: string, currentSessionToken: string): Promise<number> {
    await this.ensureSchema();
    const result = await this.app.db.query<{ c: string }>(
      `
      WITH upd AS (
        UPDATE public.admin_sessions
        SET revoked_at = NOW()
        WHERE admin_id = $1::uuid
          AND session_token <> $2
          AND revoked_at IS NULL
        RETURNING 1
      )
      SELECT COUNT(*)::text AS c FROM upd
      `,
      [adminId, currentSessionToken],
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async countActiveSessions(adminId: string): Promise<number> {
    await this.ensureSchema();
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM public.admin_sessions
      WHERE admin_id = $1::uuid
        AND revoked_at IS NULL
      `,
      [adminId],
    );
    return Number(result.rows[0]?.c ?? "0");
  }

  async hasAnySessionHistory(adminId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.app.db.query<{ id: string }>(
      `
      SELECT id::text AS id
      FROM public.admin_sessions
      WHERE admin_id = $1::uuid
      LIMIT 1
      `,
      [adminId],
    );
    return Boolean(result.rows[0]);
  }

  async createSecurityEvent(input: {
    adminId: string;
    type: "new_device_login" | "logout_others_request" | "admin_registration";
    metadata: Record<string, unknown>;
    status?: "pending" | "approved" | "rejected";
  }): Promise<string> {
    await this.ensureSchema();
    const result = await this.app.db.query<{ id: string }>(
      `
      INSERT INTO public.admin_security_events (
        admin_id,
        type,
        metadata,
        status,
        created_at,
        updated_at
      )
      VALUES ($1::uuid, $2, $3::jsonb, $4, NOW(), NOW())
      RETURNING id::text AS id
      `,
      [input.adminId, input.type, JSON.stringify(input.metadata), input.status ?? "pending"],
    );
    return result.rows[0]?.id ?? "";
  }

  async hasRecentPendingNewDeviceEvent(adminId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.app.db.query<{ id: string }>(
      `
      SELECT id::text AS id
      FROM public.admin_security_events
      WHERE admin_id = $1::uuid
        AND type = 'new_device_login'
        AND status = 'pending'
        AND created_at >= NOW() - INTERVAL '24 hours'
      LIMIT 1
      `,
      [adminId],
    );
    return Boolean(result.rows[0]);
  }

  async approveSecurityEvent(eventId: string, approvedByAdminId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.app.db.query(
      `
      UPDATE public.admin_security_events
      SET
        status = 'approved',
        approved_by = $2::uuid,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND status = 'pending'
      `,
      [eventId, approvedByAdminId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listPendingSecurityEvents(adminId: string): Promise<AdminSecurityEventRow[]> {
    await this.ensureSchema();
    const result = await this.app.db.query<AdminSecurityEventRow>(
      `
      SELECT
        id::text AS id,
        type,
        status,
        created_at
      FROM public.admin_security_events
      WHERE admin_id = $1::uuid
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [adminId],
    );
    return result.rows;
  }
}
