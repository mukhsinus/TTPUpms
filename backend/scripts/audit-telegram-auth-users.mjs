/**
 * Audits synthetic student auth users and supports optional guarded cleanup.
 *
 * Usage:
 *   node scripts/audit-telegram-auth-users.mjs
 *   node scripts/audit-telegram-auth-users.mjs --cleanup
 *
 * Requires DATABASE_URL (or SUPABASE_DB_URL / postgres SUPABASE_URL) in backend/.env.
 */

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const shouldCleanup = process.argv.includes("--cleanup");
const dbUrl =
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DB_URL ??
  (String(process.env.SUPABASE_URL ?? "").startsWith("postgres") ? process.env.SUPABASE_URL : null);

if (!dbUrl) {
  console.error("Missing DATABASE_URL (or SUPABASE_DB_URL / postgres SUPABASE_URL) in backend/.env");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 2 });

async function hasUsersAuthFk(client) {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.users'::regclass
        AND contype = 'f'
        AND conname = 'users_id_fkey'
    ) AS exists
    `,
  );
  return Boolean(result.rows[0]?.exists);
}

async function listCandidates(client) {
  return client.query(
    `
    SELECT
      au.id::text AS auth_user_id,
      au.email::text AS auth_email,
      pu.id::text AS public_user_id,
      pu.role::text AS public_role,
      pu.telegram_id::text AS telegram_id,
      EXISTS (SELECT 1 FROM public.admin_users ad WHERE ad.id = pu.id) AS in_admin_users
    FROM auth.users au
    LEFT JOIN public.users pu ON pu.id = au.id
    WHERE au.email::text ILIKE 'tg%@telegram.bot.upms'
       OR au.email::text ILIKE 'tg.%@telegram.bot.upms'
       OR au.email::text ILIKE '%@telegram.local'
    ORDER BY au.created_at DESC
    `,
  );
}

async function cleanupCandidates(client) {
  return client.query(
    `
    WITH safe AS (
      SELECT au.id
      FROM auth.users au
      INNER JOIN public.users pu ON pu.id = au.id
      LEFT JOIN public.admin_users ad ON ad.id = pu.id
      WHERE (
        au.email::text ILIKE 'tg%@telegram.bot.upms'
        OR au.email::text ILIKE 'tg.%@telegram.bot.upms'
        OR au.email::text ILIKE '%@telegram.local'
      )
        AND pu.role::text = 'student'
        AND pu.telegram_id IS NOT NULL
        AND ad.id IS NULL
    )
    DELETE FROM auth.users
    WHERE id IN (SELECT id FROM safe)
    RETURNING id::text AS deleted_auth_user_id
    `,
  );
}

try {
  const client = await pool.connect();
  try {
    const candidates = await listCandidates(client);
    const rows = candidates.rows;
    const safe = rows.filter(
      (r) => r.public_role === "student" && Boolean(r.telegram_id) && r.in_admin_users === false,
    );

    const report = {
      totalCandidates: rows.length,
      safeStudentOnlyCandidates: safe.length,
      candidates: rows,
    };

    if (!shouldCleanup) {
      console.log(JSON.stringify({ mode: "audit", ...report }, null, 2));
      process.exit(0);
    }

    const fkStillExists = await hasUsersAuthFk(client);
    if (fkStillExists) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            mode: "cleanup",
            reason: "users_id_fkey still exists. Apply migration before cleanup to avoid cascading public.users delete.",
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    await client.query("BEGIN");
    const deleted = await cleanupCandidates(client);
    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "cleanup",
          deletedCount: deleted.rowCount ?? 0,
          deleted: deleted.rows,
          audit: report,
        },
        null,
        2,
      ),
    );
  } finally {
    client.release();
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2));
  process.exit(1);
} finally {
  await pool.end();
}
