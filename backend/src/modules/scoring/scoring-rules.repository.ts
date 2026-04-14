import type { FastifyInstance } from "fastify";
import type { ScoringRuleRow } from "./scoring-metadata";

export class ScoringRulesRepository {
  constructor(private readonly app: FastifyInstance) {}

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
