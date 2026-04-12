import type { FastifyInstance } from "fastify";

interface TopStudentRow {
  user_id: string;
  email: string;
  full_name: string | null;
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
  email: string;
  fullName: string | null;
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
  constructor(private readonly app: FastifyInstance) {}

  async getTopStudents(limit: number): Promise<TopStudent[]> {
    const result = await this.app.db.query<TopStudentRow>(
      `
      SELECT
        s.user_id,
        u.email,
        u.full_name,
        COALESCE(SUM(s.total_points), 0)::text AS approved_points,
        COUNT(*)::text AS approved_submissions
      FROM submissions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.status = 'approved'
      GROUP BY s.user_id, u.email, u.full_name
      ORDER BY COALESCE(SUM(s.total_points), 0) DESC
      LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      approvedPoints: Number(row.approved_points),
      approvedSubmissions: Number(row.approved_submissions),
    }));
  }

  async getScoresByCategory(from?: string, to?: string): Promise<ScoreByCategory[]> {
    const result = await this.app.db.query<ScoreByCategoryRow>(
      `
      SELECT
        si.category,
        COALESCE(SUM(COALESCE(si.approved_score, si.reviewer_score)), 0)::text AS approved_points,
        COUNT(*)::text AS approved_items
      FROM submission_items si
      INNER JOIN submissions s ON s.id = si.submission_id
      WHERE si.review_decision = 'approved'
        AND ($1::timestamptz IS NULL OR s.created_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR s.created_at <= $2::timestamptz)
      GROUP BY si.category
      ORDER BY COALESCE(SUM(COALESCE(si.approved_score, si.reviewer_score)), 0) DESC
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
