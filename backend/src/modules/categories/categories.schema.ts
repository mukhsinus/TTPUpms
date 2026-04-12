import { z } from "zod";

export const createCategoryBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["fixed", "range", "manual"]),
  min_score: z.number().min(0).max(1_000_000),
  max_score: z.number().min(0).max(1_000_000),
  requires_review: z.boolean().optional().default(true),
  description: z.string().trim().max(5000).optional(),
});

export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
