import type { FastifyInstance } from "fastify";

interface HealStats {
  fromNeedsRevisionToSubmitted: number;
  fromSubmittedToReview: number;
  fromReviewToFinal: number;
}

function isMissingSubmissionReviewedByColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "42703";
}

async function healFromNeedsRevisionToSubmitted(app: FastifyInstance): Promise<number> {
  const result = await app.db.query<{ id: string }>(
    `
    WITH ready AS (
      SELECT s.id
      FROM public.submissions s
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE si.status = 'pending')::int AS pending_count
        FROM public.submission_items si
        WHERE si.submission_id = s.id
      ) totals
      WHERE s.status = 'needs_revision'
        AND totals.total_count > 0
        AND totals.pending_count = 0
    )
    UPDATE public.submissions s
    SET
      status = 'submitted'::public.submission_status,
      updated_at = NOW()
    FROM ready
    WHERE s.id = ready.id
    RETURNING s.id
    `,
  );
  return result.rowCount ?? 0;
}

async function healFromSubmittedToReview(app: FastifyInstance): Promise<number> {
  const result = await app.db.query<{ id: string }>(
    `
    WITH ready AS (
      SELECT s.id
      FROM public.submissions s
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE si.status = 'pending')::int AS pending_count
        FROM public.submission_items si
        WHERE si.submission_id = s.id
      ) totals
      WHERE s.status = 'submitted'
        AND totals.total_count > 0
        AND totals.pending_count = 0
    )
    UPDATE public.submissions s
    SET
      status = 'review'::public.submission_status,
      updated_at = NOW()
    FROM ready
    WHERE s.id = ready.id
    RETURNING s.id
    `,
  );
  return result.rowCount ?? 0;
}

async function healFromReviewToFinal(app: FastifyInstance): Promise<number> {
  try {
    const result = await app.db.query<{ id: string }>(
      `
      WITH ready AS (
        SELECT
          s.id,
          CASE
            WHEN totals.approved_count > 0 THEN 'approved'
            ELSE 'rejected'
          END AS final_status
        FROM public.submissions s
        CROSS JOIN LATERAL (
          SELECT
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE i.status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE i.status = 'approved')::int AS approved_count
          FROM public.submission_items i
          WHERE i.submission_id = s.id
        ) totals
        WHERE s.status = 'review'
          AND totals.total_count > 0
          AND totals.pending_count = 0
        GROUP BY s.id, totals.approved_count
      )
      UPDATE public.submissions s
      SET
        status = ready.final_status::public.submission_status,
        reviewed_at = COALESCE(s.reviewed_at, NOW()),
        updated_at = NOW()
      FROM ready
      WHERE s.id = ready.id
      RETURNING s.id
      `,
    );
    return result.rowCount ?? 0;
  } catch (error) {
    if (!isMissingSubmissionReviewedByColumn(error)) {
      throw error;
    }
    const legacyResult = await app.db.query<{ id: string }>(
      `
      WITH ready AS (
        SELECT
          s.id,
          CASE
            WHEN totals.approved_count > 0 THEN 'approved'
            ELSE 'rejected'
          END AS final_status
        FROM public.submissions s
        CROSS JOIN LATERAL (
          SELECT
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE i.status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE i.status = 'approved')::int AS approved_count
          FROM public.submission_items i
          WHERE i.submission_id = s.id
        ) totals
        WHERE s.status = 'review'
          AND totals.total_count > 0
          AND totals.pending_count = 0
      )
      UPDATE public.submissions s
      SET
        status = ready.final_status::public.submission_status,
        updated_at = NOW()
      FROM ready
      WHERE s.id = ready.id
      RETURNING s.id
      `,
    );
    return legacyResult.rowCount ?? 0;
  }
}

export async function healSubmissionStatusesFromItems(app: FastifyInstance): Promise<HealStats> {
  const stats: HealStats = {
    fromNeedsRevisionToSubmitted: 0,
    fromSubmittedToReview: 0,
    fromReviewToFinal: 0,
  };
  stats.fromNeedsRevisionToSubmitted = await healFromNeedsRevisionToSubmitted(app);
  stats.fromSubmittedToReview = await healFromSubmittedToReview(app);
  stats.fromReviewToFinal = await healFromReviewToFinal(app);
  return stats;
}
