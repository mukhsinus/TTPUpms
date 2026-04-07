import type { FastifyInstance } from "fastify";

interface UserRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  email: string;
  full_name: string | null;
  telegram_user_id: string | null;
}

interface SubmissionRow {
  id: string;
  title: string;
  status: string;
  total_points: string;
  created_at: string;
}

export interface BotUser {
  id: string;
  role: "student" | "reviewer" | "admin";
  email: string;
  fullName: string | null;
}

export class BotApiService {
  constructor(private readonly app: FastifyInstance) {}

  async findUserByTelegramId(telegramUserId: number): Promise<BotUser | null> {
    const result = await this.app.db.query<UserRow>(
      `
      SELECT id, role, email, full_name, telegram_user_id
      FROM users
      WHERE telegram_user_id = $1
      LIMIT 1
      `,
      [telegramUserId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      role: row.role,
      email: row.email,
      fullName: row.full_name,
    };
  }

  async linkTelegramByEmail(email: string, telegramUserId: number): Promise<BotUser | null> {
    const result = await this.app.db.query<UserRow>(
      `
      UPDATE users
      SET telegram_user_id = $2, updated_at = NOW()
      WHERE lower(email) = lower($1)
      RETURNING id, role, email, full_name, telegram_user_id
      `,
      [email, telegramUserId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      role: row.role,
      email: row.email,
      fullName: row.full_name,
    };
  }

  async createAchievementSubmission(input: {
    userId: string;
    category: string;
    details: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const submissionResult = await client.query<{ id: string }>(
        `
        INSERT INTO submissions (user_id, title, description, status, submitted_at)
        VALUES ($1, $2, $3, 'submitted', NOW())
        RETURNING id
        `,
        [input.userId, `Achievement: ${input.category}`, input.details],
      );

      const submissionId = submissionResult.rows[0].id;

      await client.query(
        `
        INSERT INTO submission_items (
          submission_id,
          user_id,
          category,
          title,
          description,
          proof_file_url,
          proposed_score
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          submissionId,
          input.userId,
          input.category,
          `Achievement: ${input.category}`,
          input.details,
          input.proofFileUrl,
          0,
        ],
      );

      await client.query("COMMIT");
      return { submissionId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserSubmissions(userId: string): Promise<SubmissionRow[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, title, status, total_points, created_at
      FROM submissions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [userId],
    );

    return result.rows;
  }

  async getUserApprovedPoints(userId: string): Promise<number> {
    const result = await this.app.db.query<{ total: string }>(
      `
      SELECT COALESCE(SUM(total_points), 0)::text AS total
      FROM submissions
      WHERE user_id = $1
        AND status = 'approved'
      `,
      [userId],
    );

    return Number(result.rows[0]?.total ?? "0");
  }
}
