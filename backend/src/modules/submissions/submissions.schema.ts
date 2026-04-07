import { z } from "zod";

export const submissionStatusSchema = z.enum([
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "needs_revision",
]);

export const createSubmissionBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  userId: z.string().uuid().optional(),
});

export const submissionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const getUserSubmissionsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
});

export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;
export type CreateSubmissionBody = z.infer<typeof createSubmissionBodySchema>;
export type SubmissionParams = z.infer<typeof submissionParamsSchema>;
export type GetUserSubmissionsQuery = z.infer<typeof getUserSubmissionsQuerySchema>;
