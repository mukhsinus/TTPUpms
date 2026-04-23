import { z } from "zod";
import { normalizeStudentId } from "../../utils/student-id";
import { phoneSchema } from "../users/users.schema";

/** Normalized moderation status exposed on admin APIs (maps from DB workflow states). */
export const adminModerationStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const adminSemesterScopeSchema = z.enum(["active", "first", "second", "all"]);

export const adminSubmissionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const adminDashboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  forceRefresh: z.coerce.boolean().optional().default(false),
});

export const adminDashboardAdminParamsSchema = z.object({
  adminId: z.string().uuid(),
});

export const adminSearchSuggestionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const adminStudentOverviewQuerySchema = z.object({
  studentId: z.string().trim().min(1).max(64),
  semester: adminSemesterScopeSchema.default("active"),
});

export const adminStudentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(200).optional(),
  faculty: z.string().trim().min(1).max(200).optional(),
  degree: z.enum(["bachelor", "master"]).optional(),
  sort: z.enum(["newest", "oldest", "name"]).default("newest"),
  semester: adminSemesterScopeSchema.default("active"),
});

export const adminStudentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const adminStudentDetailQuerySchema = z.object({
  semester: adminSemesterScopeSchema.default("active"),
});

export const adminUpdateStudentBodySchema = z.object({
  full_name: z.string().trim().min(1).max(300),
  degree: z.enum(["bachelor", "master"]),
  faculty: z.string().trim().min(1).max(200),
  student_id: z.string().trim().min(1).max(64).transform((v) => normalizeStudentId(v)),
  email: z.string().trim().email().optional().nullable(),
  /** When DB has `users.phone`; omitted = leave unchanged. */
  phone: phoneSchema.optional(),
});

export const adminSubmissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  forceRefresh: z.coerce.boolean().optional().default(false),
  status: adminModerationStatusSchema.optional(),
  category: z.string().trim().min(1).max(128).optional(),
  categoryKey: z.string().trim().min(1).max(128).optional(),
  /** Title / student name search (server-side; uses trigram indexes when present). */
  search: z.string().trim().min(1).max(200).optional(),
  /** ISO-8601 timestamps (e.g. from `Date.toISOString()`). */
  dateFrom: z.string().trim().min(1).optional(),
  dateTo: z.string().trim().min(1).optional(),
  sort: z.enum(["created_at", "title", "status", "score"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  /** Default active = current global academic semester (system settings). */
  semester: adminSemesterScopeSchema.default("active"),
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

export type AdminSemesterScope = z.infer<typeof adminSemesterScopeSchema>;
export type AdminModerationStatus = z.infer<typeof adminModerationStatusSchema>;
export type AdminDashboardQuery = z.infer<typeof adminDashboardQuerySchema>;
export type AdminSubmissionsQuery = z.infer<typeof adminSubmissionsQuerySchema>;
export type AdminApproveBody = z.infer<typeof adminApproveBodySchema>;
export type AdminRejectBody = z.infer<typeof adminRejectBodySchema>;
export type AdminSearchSuggestionsQuery = z.infer<typeof adminSearchSuggestionsQuerySchema>;
export type AdminStudentOverviewQuery = z.infer<typeof adminStudentOverviewQuerySchema>;
export type AdminStudentsQuery = z.infer<typeof adminStudentsQuerySchema>;
export type AdminStudentIdParams = z.infer<typeof adminStudentIdParamsSchema>;
export type AdminUpdateStudentBody = z.infer<typeof adminUpdateStudentBodySchema>;
