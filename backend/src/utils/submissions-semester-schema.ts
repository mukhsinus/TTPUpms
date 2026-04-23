import type { FastifyInstance } from "fastify";

let cached: boolean | null = null;
let warnedMissing = false;

/**
 * Whether `public.submissions.semester` exists (academic period migration applied).
 * Result is cached for the process lifetime — restart after running migrations.
 */
export async function getSubmissionsSemesterColumnPresent(app: FastifyInstance): Promise<boolean> {
  if (cached !== null) {
    return cached;
  }
  const result = await app.db.query<{ e: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'submissions'
        AND column_name = 'semester'
    ) AS e
    `,
  );
  cached = result.rows[0]?.e === true;
  if (!cached && !warnedMissing) {
    warnedMissing = true;
    app.log.warn(
      "submissions.semester column is missing; semester filters are disabled until migrations are applied (e.g. 20260623120000_academic_semester.sql).",
    );
  }
  return cached;
}

/** For tests only */
export function resetSubmissionsSemesterColumnCacheForTests(): void {
  cached = null;
  warnedMissing = false;
}
