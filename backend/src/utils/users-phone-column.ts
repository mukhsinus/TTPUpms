import type { FastifyInstance } from "fastify";

/** Only cache positive detection — never cache `false`, so a migration applied after server start is picked up. */
let phoneColumnKnownPresent: boolean | null = null;
let warnedMissing = false;

/**
 * Idempotent DDL so remote DBs work even when `supabase/migrations` was not applied.
 * Matches `20260622120000_users_phone_nullable.sql`.
 */
export async function ensureUsersPhoneColumn(app: FastifyInstance): Promise<void> {
  try {
    await app.db.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text`);
    phoneColumnKnownPresent = true;
    warnedMissing = false;
    app.log.info("Ensured public.users.phone column exists");
  } catch (err) {
    app.log.warn({ err }, "Could not ensure users.phone column at startup; phone writes stay conditional");
  }
}

/**
 * Whether `public.users.phone` exists (Telegram onboarding / profile).
 * When the column is confirmed present, result is cached for the process lifetime.
 */
export async function getUsersPhoneColumnPresent(app: FastifyInstance): Promise<boolean> {
  if (phoneColumnKnownPresent === true) {
    return true;
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
  const present = result.rows[0]?.e === true;
  if (present) {
    phoneColumnKnownPresent = true;
  } else if (!warnedMissing) {
    warnedMissing = true;
    app.log.warn(
      "users.phone column is missing; phone will not be stored until migrations are applied (e.g. 20260622120000_users_phone_nullable.sql).",
    );
  }
  return present;
}

/** For tests only */
export function resetUsersPhoneColumnCacheForTests(): void {
  phoneColumnKnownPresent = null;
  warnedMissing = false;
}
