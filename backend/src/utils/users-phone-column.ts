import type { FastifyInstance } from "fastify";

let cached: boolean | null = null;
let warnedMissing = false;

/**
 * Whether `public.users.phone` exists (Telegram onboarding / profile).
 * Cached for the process lifetime — restart after migrations.
 */
export async function getUsersPhoneColumnPresent(app: FastifyInstance): Promise<boolean> {
  if (cached !== null) {
    return cached;
  }
  const result = await app.db.query<{ e: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'phone'
    ) AS e
    `,
  );
  cached = result.rows[0]?.e === true;
  if (!cached && !warnedMissing) {
    warnedMissing = true;
    app.log.warn(
      "users.phone column is missing; phone will not be stored until migrations are applied (e.g. 20260622120000_users_phone_nullable.sql).",
    );
  }
  return cached;
}

/** For tests only */
export function resetUsersPhoneColumnCacheForTests(): void {
  cached = null;
  warnedMissing = false;
}
