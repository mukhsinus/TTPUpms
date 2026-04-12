import type { FastifyInstance } from "fastify";

export type CategoryScoringType = "fixed" | "range" | "manual";

interface CategoryRow {
  id: string;
  name: string;
  type: CategoryScoringType;
  min_score: string;
  max_score: string;
  description: string | null;
  requires_review: boolean;
  created_at: string;
}

interface SubcategoryRow {
  id: string;
  category_id: string;
  slug: string;
  label: string;
  sort_order: number;
  created_at: string;
}

interface ScoringRuleRow {
  id: string;
  category_id: string;
  subcategory_id: string | null;
  min_score: string;
  max_score: string;
  notes: string | null;
  created_at: string;
}

export interface CategoryScoringRuleEntity {
  id: string;
  categoryId: string;
  subcategoryId: string | null;
  minScore: number;
  maxScore: number;
  notes: string | null;
  createdAt: string;
}

export interface SubcategoryEntity {
  id: string;
  categoryId: string;
  slug: string;
  label: string;
  sortOrder: number;
  createdAt: string;
  scoringRules: CategoryScoringRuleEntity[];
}

export interface CategoryEntity {
  id: string;
  name: string;
  type: CategoryScoringType;
  minScore: number;
  maxScore: number;
  description: string | null;
  requiresReview: boolean;
  createdAt: string;
  categoryScoringRules: CategoryScoringRuleEntity[];
  subcategories: SubcategoryEntity[];
}

function mapRule(row: ScoringRuleRow): CategoryScoringRuleEntity {
  return {
    id: row.id,
    categoryId: row.category_id,
    subcategoryId: row.subcategory_id,
    minScore: Number(row.min_score),
    maxScore: Number(row.max_score),
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export class CategoriesRepository {
  constructor(private readonly app: FastifyInstance) {}

  async listScoringConfiguration(): Promise<CategoryEntity[]> {
    const categoriesResult = await this.app.db.query<CategoryRow>(
      `
      SELECT id, name, type, min_score, max_score, description, requires_review, created_at
      FROM public.categories
      ORDER BY name ASC
      `,
    );

    const categories = categoriesResult.rows;
    if (categories.length === 0) {
      return [];
    }

    const categoryIds = categories.map((c) => c.id);

    const [subsResult, rulesResult] = await Promise.all([
      this.app.db.query<SubcategoryRow>(
        `
        SELECT id, category_id, slug, label, sort_order, created_at
        FROM public.category_subcategories
        WHERE category_id = ANY($1::uuid[])
        ORDER BY category_id ASC, sort_order ASC, slug ASC
        `,
        [categoryIds],
      ),
      this.app.db.query<ScoringRuleRow>(
        `
        SELECT id, category_id, subcategory_id, min_score, max_score, notes, created_at
        FROM public.category_scoring_rules
        WHERE category_id = ANY($1::uuid[])
        ORDER BY category_id ASC, subcategory_id NULLS FIRST, min_score ASC
        `,
        [categoryIds],
      ),
    ]);

    const rulesBySub = new Map<string, CategoryScoringRuleEntity[]>();
    const rulesByCategoryOnly = new Map<string, CategoryScoringRuleEntity[]>();

    for (const row of rulesResult.rows) {
      const entity = mapRule(row);
      if (row.subcategory_id === null) {
        const list = rulesByCategoryOnly.get(row.category_id) ?? [];
        list.push(entity);
        rulesByCategoryOnly.set(row.category_id, list);
      } else {
        const list = rulesBySub.get(row.subcategory_id) ?? [];
        list.push(entity);
        rulesBySub.set(row.subcategory_id, list);
      }
    }

    const subsByCategory = new Map<string, SubcategoryRow[]>();
    for (const s of subsResult.rows) {
      const list = subsByCategory.get(s.category_id) ?? [];
      list.push(s);
      subsByCategory.set(s.category_id, list);
    }

    return categories.map((c) => {
      const subRows = subsByCategory.get(c.id) ?? [];
      const subcategories: SubcategoryEntity[] = subRows.map((s) => ({
        id: s.id,
        categoryId: s.category_id,
        slug: s.slug,
        label: s.label,
        sortOrder: s.sort_order,
        createdAt: s.created_at,
        scoringRules: rulesBySub.get(s.id) ?? [],
      }));

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        minScore: Number(c.min_score),
        maxScore: Number(c.max_score),
        description: c.description,
        requiresReview: c.requires_review,
        createdAt: c.created_at,
        categoryScoringRules: rulesByCategoryOnly.get(c.id) ?? [],
        subcategories,
      };
    });
  }
}
