/**
 * Creates two confirmed Auth users and matching public.users rows for manual / bot E2E.
 * Run: node scripts/seed-e2e-users.mjs
 * Requires: SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (or pooler URL in env).
 * Optional: SEED_E2E_PASSWORD (min 8 chars). Default is for local dev only — change in production.
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const STUDENT_EMAIL = "upms.e2e.student@test.local";
const REVIEWER_EMAIL = "upms.e2e.reviewer@test.local";
const password =
  process.env.SEED_E2E_PASSWORD && process.env.SEED_E2E_PASSWORD.length >= 8
    ? process.env.SEED_E2E_PASSWORD
    : "UpmsE2E_Seed_ChangeMe_2026!";

const projectUrl = process.env.SUPABASE_PROJECT_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DB_URL ??
  (String(process.env.SUPABASE_URL ?? "").startsWith("postgres") ? process.env.SUPABASE_URL : null);

if (!projectUrl || !serviceKey || !dbUrl) {
  console.error("Missing SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY, or database URL in .env");
  process.exit(1);
}

const admin = createClient(projectUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureAuthUser(email, appMetadata) {
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (list.error) throw list.error;
  const found = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) {
    await admin.auth.admin.updateUserById(found.id, {
      email_confirm: true,
      app_metadata: { ...found.app_metadata, ...appMetadata },
    });
    return found.id;
  }
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}

async function ensurePublicUser(client, id, email, fullName, role) {
  await client.query(
    `
    INSERT INTO public.users (id, email, full_name, role)
    VALUES ($1, $2, $3, $4::public.user_role)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
      role = EXCLUDED.role::public.user_role,
      updated_at = NOW()
    `,
    [id, email, fullName, role],
  );
}

const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 2 });

try {
  const studentId = await ensureAuthUser(STUDENT_EMAIL, { role: "student" });
  const reviewerId = await ensureAuthUser(REVIEWER_EMAIL, { role: "reviewer" });

  const client = await pool.connect();
  try {
    await ensurePublicUser(client, studentId, STUDENT_EMAIL, "E2E Student", "student");
    await ensurePublicUser(client, reviewerId, REVIEWER_EMAIL, "E2E Reviewer", "reviewer");
  } finally {
    client.release();
  }

  console.log(JSON.stringify({ ok: true, studentId, reviewerId, STUDENT_EMAIL, REVIEWER_EMAIL }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
} finally {
  await pool.end();
}
