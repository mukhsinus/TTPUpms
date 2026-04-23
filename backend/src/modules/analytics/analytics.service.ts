import type { FastifyInstance } from "fastify";
import type { SystemPhaseService } from "../system/system-phase.service";

interface TopStudentRow {
  user_id: string;
  full_name: string | null;
  telegram_username: string | null;
  telegram_id: string | null;
  approved_points: string;
  approved_submissions: string;
}

interface ScoreByCategoryRow {
  category: string;
  approved_points: string;
  approved_items: string;
}

interface ActivityStatRow {
  status: string;
  count: string;
}

export interface TopStudent {
  userId: string;
  fullName: string | null;
  telegramUsername: string | null;
  telegramId: string | null;
  approvedPoints: number;
  approvedSubmissions: number;
}

export interface ScoreByCategory {
  category: string;
  approvedPoints: number;
  approvedItems: number;
}

export interface ActivityStat {
  status: string;
  count: number;
}

export class AnalyticsService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly phase: SystemPhaseService,
  ) {}

  async getTopStudents(limit: number): Promise<TopStudent[]> {
    const semester = await this.phase.getCurrentSemester();
    const result = await this.app.db.query<TopStudentRow>(
      `
      SELECT
        s.user_id,
        u.full_name,
        to_jsonb(u)->>'telegram_username' AS telegram_username,
        u.telegram_id::text AS telegram_id,
        COALESCE(SUM(s.total_score), 0)::text AS approved_points,
        COUNT(*)::text AS approved_submissions
      FROM submissions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.status = 'approved'
        AND s.semester = $2
      GROUP BY s.user_id, u.full_name, to_jsonb(u)->>'telegram_username', u.telegram_id
      ORDER BY COALESCE(SUM(s.total_score), 0) DESC
      LIMIT $1
      `,
      [limit, semester],
    );

    return result.rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      telegramUsername: row.telegram_username,
      telegramId: row.telegram_id,
      approvedPoints: Number(row.approved_points),
      approvedSubmissions: Number(row.approved_submissions),
    }));
  }

  async getScoresByCategory(from?: string, to?: string): Promise<ScoreByCategory[]> {
    const result = await this.app.db.query<ScoreByCategoryRow>(
      `
      SELECT
        c.name AS category,
        COALESCE(SUM(si.approved_score), 0)::text AS approved_points,
        COUNT(*)::text AS approved_items
      FROM submission_items si
      INNER JOIN submissions s ON s.id = si.submission_id
      INNER JOIN public.categories c ON c.id = si.category_id
      WHERE si.status = 'approved'
        AND ($1::timestamptz IS NULL OR s.created_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR s.created_at <= $2::timestamptz)
      GROUP BY c.name
      ORDER BY COALESCE(SUM(si.approved_score), 0) DESC
      `,
      [from ?? null, to ?? null],
    );

    return result.rows.map((row) => ({
      category: row.category,
      approvedPoints: Number(row.approved_points),
      approvedItems: Number(row.approved_items),
    }));
  }

  async getActivityStats(from?: string, to?: string): Promise<ActivityStat[]> {
    const result = await this.app.db.query<ActivityStatRow>(
      `
      SELECT s.status, COUNT(*)::text AS count
      FROM submissions s
      WHERE ($1::timestamptz IS NULL OR s.created_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR s.created_at <= $2::timestamptz)
      GROUP BY s.status
      ORDER BY COUNT(*) DESC
      `,
      [from ?? null, to ?? null],
    );

    return result.rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));
  }
}
