import type { FastifyInstance } from "fastify";
import { getPostgresDriverErrorFields } from "../../utils/pg-http-map";

interface DuplicateRow {
  id: string;
}

class AntiFraudError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AntiFraudError";
  }
}

function normalizeDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AntiFraudError(400, "Invalid activity date");
  }
  return date;
}

export class AntiFraudService {
  constructor(private readonly app: FastifyInstance) {}

  async assertNoDuplicateSubmission(input: {
    userId: string;
    title: string;
    description?: string;
  }): Promise<void> {
    const result = await this.app.db.query<DuplicateRow>(
      `
      SELECT id
      FROM submissions
      WHERE user_id = $1
        AND lower(title) = lower($2)
        AND coalesce(description, '') = coalesce($3, '')
        /* Drafts may share a neutral title; duplicates are enforced once work is in the pipeline. */
        AND status IN ('submitted', 'review', 'approved', 'needs_revision')
      LIMIT 1
      `,
      [input.userId, input.title.trim(), input.description?.trim() ?? null],
    );

    if (result.rows[0]) {
      throw new AntiFraudError(409, "Duplicate submission detected");
    }
  }

  async assertNoDuplicateFile(input: { userId: string; checksum: string }): Promise<void> {
    let result;
    try {
      result = await this.app.db.query<DuplicateRow>(
        `
        SELECT id
        FROM files
        WHERE user_id = $1
          AND checksum_sha256 = $2
        LIMIT 1
        `,
        [input.userId, input.checksum],
      );
    } catch (error) {
      const pg = getPostgresDriverErrorFields(error);
      if (pg?.code === "42P01" || pg?.code === "42703") {
        this.app.log.warn(
          { user_id: input.userId, code: pg.code, message: pg.message },
          "Skipping duplicate file check: files schema is behind",
        );
        return;
      }
      throw error;
    }

    if (result.rows[0]) {
      throw new AntiFraudError(409, "Duplicate file detected");
    }
  }

  assertValidActivityDate(activityDate?: string): void {
    if (!activityDate) {
      return;
    }

    const date = normalizeDateOnly(activityDate);
    const minDate = new Date("2000-01-01T00:00:00.000Z");
    const today = new Date();
    const todayUtc = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );

    if (date > todayUtc) {
      throw new AntiFraudError(400, "Activity date cannot be in the future");
    }

    if (date < minDate) {
      throw new AntiFraudError(400, "Activity date is too old");
    }
  }
}

export { AntiFraudError };
