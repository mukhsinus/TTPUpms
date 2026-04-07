import { z } from "zod";

export const dateRangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const topStudentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export const exportQuerySchema = z.object({
  type: z.enum(["top-students", "scores-by-category", "activity-stats"]),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;
export type TopStudentsQuery = z.infer<typeof topStudentsQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
