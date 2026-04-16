export interface ScoringRuleRow {
  condition_key: string;
  condition_value: string;
  points: number;
  sort_order: number;
}

export function normalizeMetadata(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function metaValueToComparableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length ? t : null;
  }
  return null;
}

/**
 * First matching rule wins (lowest sort_order first). Logic is generic; rules live in `scoring_rules`.
 */
export function roundScore2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round2(value: number): number {
  return roundScore2(value);
}

export interface CategoryScoringBand {
  min_score: number;
  max_score: number;
}

/**
 * Fixed categories: prefer `scoring_rules` row matched by metadata; if none match, use
 * `category_scoring_rules` band intersected with category bounds; else category floor.
 * Never throws — callers use this instead of failing when metadata is empty or incomplete.
 */
export function resolveFixedProposedScore(input: {
  metadata: Record<string, unknown>;
  scoringRules: ScoringRuleRow[];
  categoryScoring: CategoryScoringBand | null;
  bounds: { minScore: number; maxScore: number };
}): number {
  const matched = resolveFixedPointsFromRules(input.metadata, input.scoringRules);
  if (matched !== null) {
    return round2(matched);
  }

  if (input.categoryScoring) {
    const lo = Math.max(input.categoryScoring.min_score, input.bounds.minScore);
    const hi = Math.min(input.categoryScoring.max_score, input.bounds.maxScore);
    if (lo <= hi) {
      return round2(lo);
    }
  }

  return round2(input.bounds.minScore);
}

export function resolveFixedPointsFromRules(
  metadata: Record<string, unknown>,
  rules: ScoringRuleRow[],
): number | null {
  const sorted = [...rules].sort((a, b) => {
    if (a.sort_order !== b.sort_order) {
      return a.sort_order - b.sort_order;
    }
    const k = a.condition_key.localeCompare(b.condition_key);
    if (k !== 0) {
      return k;
    }
    return a.condition_value.localeCompare(b.condition_value);
  });

  for (const r of sorted) {
    const v = metaValueToComparableString(metadata[r.condition_key]);
    if (v !== null && v === r.condition_value) {
      return r.points;
    }
  }
  return null;
}
