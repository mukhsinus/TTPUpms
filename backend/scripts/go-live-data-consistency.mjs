/**
 * Read-only consistency checks against DATABASE_URL (from backend/.env).
 * Logs JSON lines only — no deletes or updates.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.log(JSON.stringify({ event: "go_live_db_check", level: "ERROR", message: "DATABASE_URL unset" }));
  process.exit(2);
}

const ssl =
  url.includes("supabase.co") || url.includes("pooler.supabase.com")
    ? { rejectUnauthorized: false }
    : undefined;

const client = new pg.Client({ connectionString: url, ssl });
await client.connect();

const checks = [
  {
    name: "orphan_submission_items",
    sql: `
      SELECT si.id::text AS id, si.submission_id::text AS submission_id
      FROM submission_items si
      LEFT JOIN submissions s ON s.id = si.submission_id
      WHERE s.id IS NULL
      LIMIT 100`,
  },
  {
    name: "invalid_category_id",
    sql: `
      SELECT si.id::text AS id, si.category_id::text AS category_id
      FROM submission_items si
      LEFT JOIN categories c ON c.id = si.category_id
      WHERE si.category_id IS NOT NULL AND c.id IS NULL
      LIMIT 100`,
  },
  {
    name: "invalid_subcategory_id",
    sql: `
      SELECT si.id::text AS id, si.subcategory_id::text AS subcategory_id
      FROM submission_items si
      LEFT JOIN category_subcategories cs ON cs.id = si.subcategory_id
      WHERE si.subcategory_id IS NOT NULL AND cs.id IS NULL
      LIMIT 100`,
  },
  {
    name: "category_subcategory_mismatch",
    sql: `
      SELECT si.id::text AS id, si.category_id::text AS category_id, si.subcategory_id::text AS subcategory_id
      FROM submission_items si
      JOIN category_subcategories cs ON cs.id = si.subcategory_id
      WHERE si.category_id IS DISTINCT FROM cs.category_id
      LIMIT 100`,
  },
];

for (const { name, sql } of checks) {
  const r = await client.query(sql);
  console.log(
    JSON.stringify({
      event: "go_live_db_check",
      check: name,
      rowCount: r.rowCount,
      rows: r.rows,
    }),
  );
}

const we = await client.query(`
  SELECT COUNT(*)::int AS n
  FROM category_subcategories cs
  JOIN categories c ON c.id = cs.category_id
  WHERE c.name = 'work_experience'
`);
const weSlugs = await client.query(`
  SELECT cs.slug
  FROM category_subcategories cs
  JOIN categories c ON c.id = cs.category_id
  WHERE c.name = 'work_experience'
  ORDER BY cs.sort_order, cs.slug
`);
console.log(
  JSON.stringify({
    event: "go_live_db_check",
    check: "work_experience_subcategory_count",
    count: we.rows[0]?.n ?? null,
    slugs: weSlugs.rows.map((row) => row.slug),
  }),
);

await client.end();
