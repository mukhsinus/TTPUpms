import { z } from "zod";

/** Normalized moderation status exposed on admin APIs (maps from DB workflow states). */
export const adminModerationStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const adminSubmissionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const adminSubmissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: adminModerationStatusSchema.optional(),
  category: z.string().trim().min(1).max(128).optional(),
  /** Title / student name search (server-side; uses trigram indexes when present). */
  search: z.string().trim().min(1).max(200).optional(),
  /** ISO-8601 timestamps (e.g. from `Date.toISOString()`). */
  dateFrom: z.string().trim().min(1).optional(),
  dateTo: z.string().trim().min(1).optional(),
  sort: z.enum(["created_at", "title", "status", "score"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const adminApproveBodySchema = z
  .object({
    score: z.number().min(0).optional(),
  })
  .strict();

export const adminRejectBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type AdminModerationStatus = z.infer<typeof adminModerationStatusSchema>;
export type AdminSubmissionsQuery = z.infer<typeof adminSubmissionsQuerySchema>;
export type AdminApproveBody = z.infer<typeof adminApproveBodySchema>;
export type AdminRejectBody = z.infer<typeof adminRejectBodySchema>;
