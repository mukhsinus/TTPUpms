import type { Pool } from "pg";

export interface AuthUserLike {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

export function parseAdminEmailSet(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!raw) return set;
  for (const part of raw.split(",")) {
    const e = part.trim().toLowerCase();
    if (e.length > 0) {
      set.add(e);
    }
  }
  return set;
}

export function isAdminEmail(email: string | null | undefined, admins: Set<string>): boolean {
  if (!email) return false;
  return admins.has(email.trim().toLowerCase());
}

export async function isAdminUsersListed(db: Pool, userId: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `
    SELECT true AS ok
    FROM public.admin_users
    WHERE id = $1::uuid
      AND role::text IN ('admin', 'superadmin')
    LIMIT 1
    `,
    [userId],
  );
  return Boolean(r.rows[0]?.ok);
}

export interface SyncPublicUserOptions {
  /**
   * When true (admin web login with `X-Upms-Auth-Source: admin_panel`), allow promoting this
   * principal only when also listed in `public.admin_users` or `ADMIN_EMAILS`. Bot/API flows omit this flag.
   */
  adminPanelLogin?: boolean;
}

/**
 * Ensures `public.users` has a row for this Supabase user and normalizes `role`.
 * `adminPanelLogin` must only be true when the caller already verified the user is in `admin_users`
 * or `ADMIN_EMAILS` — it no longer elevates arbitrary accounts.
 */
export async function syncPublicUserRoleFromAuth(
  db: Pool,
  authUser: AuthUserLike,
  adminEmails: Set<string>,
  options?: SyncPublicUserOptions,
): Promise<{ roleText: string }> {
  const email = authUser.email?.trim() ?? null;
  const forceAdmin = isAdminEmail(email, adminEmails);
  const adminPanelLogin = Boolean(options?.adminPanelLogin);
  const fullName =
    typeof authUser.user_metadata?.full_name === "string"
      ? authUser.user_metadata.full_name
      : typeof authUser.user_metadata?.name === "string"
        ? authUser.user_metadata.name
        : null;

  const emailForInsert = email && email.length > 0 ? email : null;

  const initialRole = forceAdmin || adminPanelLogin ? "admin" : "student";

  const res = await db.query<{ role: string }>(
    `
    INSERT INTO public.users (id, email, role, full_name)
    VALUES ($1::uuid, $2::citext, $3::public.user_role, $4)
    ON CONFLICT (id) DO UPDATE SET
      email = CASE
        WHEN btrim(EXCLUDED.email::text) <> '' THEN EXCLUDED.email
        ELSE public.users.email
      END,
      role = CASE
        WHEN public.users.role::text = 'superadmin' THEN public.users.role
        WHEN $5::boolean THEN 'admin'::public.user_role
        WHEN $6::boolean THEN 'admin'::public.user_role
        WHEN public.users.role IS NULL THEN 'student'::public.user_role
        ELSE public.users.role
      END,
      full_name = COALESCE(public.users.full_name, EXCLUDED.full_name),
      updated_at = NOW()
    RETURNING role::text AS role
    `,
    [authUser.id, emailForInsert, initialRole, fullName, forceAdmin, adminPanelLogin],
  );

  const roleText = res.rows[0]?.role ?? "student";

  if (roleText === "admin" || roleText === "superadmin") {
    await ensureAdminUsersRow(db, authUser.id);
  }

  return { roleText };
}

/**
 * Keeps `public.admin_users` aligned when `public.users` holds an elevated role (allowlist for the panel).
 */
async function ensureAdminUsersRow(db: Pool, userId: string): Promise<void> {
  await db.query(
    `
    INSERT INTO public.admin_users (id, email, role, created_at)
    SELECT u.id, u.email, u.role, u.created_at
    FROM public.users u
    WHERE u.id = $1::uuid
      AND u.role::text IN ('admin', 'superadmin')
      AND u.email IS NOT NULL
    ON CONFLICT ON CONSTRAINT admin_users_pkey DO UPDATE SET
      email = EXCLUDED.email,
      role = CASE
        WHEN public.admin_users.role::text = 'superadmin' THEN public.admin_users.role
        ELSE EXCLUDED.role
      END
    `,
    [userId],
  );
}
