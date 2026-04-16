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

/**
 * Ensures `public.users` has a row for this Supabase user and normalizes `role`:
 * - New row: `student`, or `admin` when email is listed in ADMIN_EMAILS.
 * - Existing row: promote to `admin` when email matches; fill null role with `student`; preserve reviewer/student otherwise.
 */
export async function syncPublicUserRoleFromAuth(
  db: Pool,
  authUser: AuthUserLike,
  adminEmails: Set<string>,
): Promise<{ roleText: string }> {
  const email = authUser.email?.trim() ?? null;
  const forceAdmin = isAdminEmail(email, adminEmails);
  const fullName =
    typeof authUser.user_metadata?.full_name === "string"
      ? authUser.user_metadata.full_name
      : typeof authUser.user_metadata?.name === "string"
        ? authUser.user_metadata.name
        : null;

  const emailForInsert =
    email && email.length > 0 ? email : `${authUser.id}@users.supabase.local`;

  const initialRole = forceAdmin ? "admin" : "student";

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
        WHEN $5::boolean THEN 'admin'::public.user_role
        WHEN public.users.role IS NULL THEN 'student'::public.user_role
        ELSE public.users.role
      END,
      full_name = COALESCE(public.users.full_name, EXCLUDED.full_name),
      updated_at = NOW()
    RETURNING role::text AS role
    `,
    [authUser.id, emailForInsert, initialRole, fullName, forceAdmin],
  );

  const roleText = res.rows[0]?.role ?? "student";
  return { roleText };
}
