import type { FastifyInstance } from "fastify";
import type { CategoryScoringBand, ScoringRuleRow } from "./scoring-metadata";

export class ScoringRulesRepository {
  constructor(private readonly app: FastifyInstance) {}

  /**
   * Prefer a row for this subcategory; else category-default row (`subcategory_id` null).
   */
  async findCategoryScoringBand(
    categoryId: string,
    subcategoryId: string,
  ): Promise<CategoryScoringBand | null> {
    const result = await this.app.db.query<{ min_score: string; max_score: string }>(
      `
      SELECT min_score::text, max_score::text
      FROM category_scoring_rules
      WHERE category_id = $1
        AND (subcategory_id = $2 OR subcategory_id IS NULL)
      ORDER BY CASE WHEN subcategory_id IS NOT NULL THEN 0 ELSE 1 END
      LIMIT 1
      `,
      [categoryId, subcategoryId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      min_score: Number(row.min_score),
      max_score: Number(row.max_score),
    };
  }

  async findRulesBySubcategoryId(subcategoryId: string): Promise<ScoringRuleRow[]> {
    const result = await this.app.db.query<{
      condition_key: string;
      condition_value: string;
      points: string;
      sort_order: string;
    }>(
      `
      SELECT condition_key, condition_value, points::text, sort_order::text
      FROM scoring_rules
      WHERE subcategory_id = $1
      ORDER BY sort_order ASC, condition_key ASC, condition_value ASC
      `,
      [subcategoryId],
    );

    return result.rows.map((row) => ({
      condition_key: row.condition_key,
      condition_value: row.condition_value,
      points: Number(row.points),
      sort_order: Number(row.sort_order),
    }));
  }
}
