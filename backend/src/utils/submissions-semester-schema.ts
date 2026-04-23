import type { FastifyInstance } from "fastify";

/** Only cache positive detection — migrations applied after boot are detected on next check. */
let semesterColumnKnownPresent: boolean | null = null;
let warnedMissing = false;

/**
 * Whether `public.submissions.semester` exists (academic period migration applied).
 * When the column is confirmed present, result is cached for the process lifetime.
 */
export async function getSubmissionsSemesterColumnPresent(app: FastifyInstance): Promise<boolean> {
  if (semesterColumnKnownPresent === true) {
    return true;
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
  const present = result.rows[0]?.e === true;
  if (present) {
    semesterColumnKnownPresent = true;
  } else if (!warnedMissing) {
    warnedMissing = true;
    app.log.warn(
      "submissions.semester column is missing; semester filters are disabled until migrations are applied (e.g. 20260623120000_academic_semester.sql).",
    );
  }
  return present;
}

/** For tests only */
export function resetSubmissionsSemesterColumnCacheForTests(): void {
  semesterColumnKnownPresent = null;
  warnedMissing = false;
}
