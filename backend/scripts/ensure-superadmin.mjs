/**
 * Creates or updates a superadmin across Supabase Auth + public.users + public.admin_users.
 *
 * Usage:
 *   node scripts/ensure-superadmin.mjs --email kamolovmuhsin@icloud.com --password 'strong-pass'
 *
 * Requires in backend/.env:
 * - SUPABASE_PROJECT_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - DATABASE_URL (or SUPABASE_DB_URL / postgres SUPABASE_URL)
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

dotenv.config({ path: new URL("../.env", import.meta.url) });

function readArg(name) {
  const prefix = `--${name}=`;
  const exact = process.argv.find((a) => a.startsWith(prefix));
  if (exact) return exact.slice(prefix.length).trim();
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return null;
}

const emailRaw = readArg("email");
const password = readArg("password");
const fullName = readArg("full-name");

if (!emailRaw || !password) {
  console.error("Usage: node scripts/ensure-superadmin.mjs --email <email> --password <password> [--full-name 'Name']");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const email = emailRaw.toLowerCase();
const projectUrl = process.env.SUPABASE_PROJECT_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DB_URL ??
  (String(process.env.SUPABASE_URL ?? "").startsWith("postgres") ? process.env.SUPABASE_URL : null);

if (!projectUrl || !serviceKey || !dbUrl) {
  console.error("Missing SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL in backend/.env");
  process.exit(1);
}

const admin = createClient(projectUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 2 });

async function findAuthUserByEmail(targetEmail) {
  let page = 1;
  while (page <= 20) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) {
      throw listed.error;
    }
    const users = listed.data?.users ?? [];
    const found = users.find((u) => String(u.email ?? "").toLowerCase() === targetEmail);
    if (found) {
      return found;
    }
    if (users.length < 200) {
      break;
    }
    page += 1;
  }
  return null;
}

async function ensureAuthSuperadmin() {
  const existing = await findAuthUserByEmail(email);
  const userMetadataPatch = {
    ...(fullName ? { full_name: fullName } : {}),
    must_change_password: true,
  };
  if (existing) {
    const updated = await admin.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
      app_metadata: { ...(existing.app_metadata ?? {}), role: "superadmin" },
      user_metadata: { ...(existing.user_metadata ?? {}), ...userMetadataPatch },
    });
    if (updated.error || !updated.data.user?.id) {
      throw updated.error ?? new Error("Failed to update existing auth user");
    }
    return { id: updated.data.user.id, created: false };
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "superadmin" },
    user_metadata: userMetadataPatch,
  });
  if (created.error || !created.data.user?.id) {
    throw created.error ?? new Error("Failed to create auth user");
  }
  return { id: created.data.user.id, created: true };
}

async function fetchAuthRole(userId) {
  const got = await admin.auth.admin.getUserById(userId);
  if (got.error || !got.data.user) {
    throw got.error ?? new Error("Failed to reload auth user after upsert");
  }
  return got.data.user.app_metadata?.role ?? null;
}

async function ensurePublicRows(client, userId) {
  await client.query(
    `
    CREATE TABLE IF NOT EXISTS public.admin_users (
      id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
      email citext NOT NULL,
      role public.user_role NOT NULL CHECK (role IN ('admin', 'superadmin')),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT admin_users_email_unique UNIQUE (email)
    )
    `,
  );

  await client.query(
    `
    INSERT INTO public.users (id, email, role, full_name)
    VALUES ($1::uuid, $2::citext, 'superadmin'::public.user_role, $3)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      role = 'superadmin'::public.user_role,
      full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
      updated_at = NOW()
    `,
    [userId, email, fullName ?? null],
  );

  await client.query(
    `
    INSERT INTO public.admin_users (id, email, role, created_at)
    VALUES ($1::uuid, $2::citext, 'superadmin'::public.user_role, NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      role = 'superadmin'::public.user_role
    `,
    [userId, email],
  );
}

async function ensureRoleEnum(client) {
  await client.query(
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        INNER JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role'
          AND e.enumlabel = 'superadmin'
      ) THEN
        ALTER TYPE public.user_role ADD VALUE 'superadmin';
      END IF;
    END
    $$;
    `,
  );
}

async function verify(client, userId) {
  const row = await client.query(
    `
    SELECT
      u.id::text AS user_id,
      u.email::text AS user_email,
      u.role::text AS user_role,
      au.email::text AS admin_email,
      au.role::text AS admin_role
    FROM public.users u
    LEFT JOIN public.admin_users au ON au.id = u.id
    WHERE u.id = $1::uuid
    `,
    [userId],
  );
  return row.rows[0] ?? null;
}

try {
  const auth = await ensureAuthSuperadmin();
  const authRole = await fetchAuthRole(auth.id);
  const client = await pool.connect();
  try {
    await ensureRoleEnum(client);
    await client.query("BEGIN");
    await ensurePublicRows(client, auth.id);
    const verification = await verify(client, auth.id);
    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          ok: true,
          authUserId: auth.id,
          authUserCreated: auth.created,
          authAppRole: authRole,
          email,
          verification,
          note: "user_metadata.must_change_password=true set; enforce in UI if desired.",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2));
  process.exit(1);
} finally {
  await pool.end();
}
