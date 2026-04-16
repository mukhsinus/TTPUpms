import { z } from "zod";

export const submissionStatusSchema = z.enum([
  "draft",
  "submitted",
  "review",
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

/** POST /:id/submit */
export const submitSubmissionParamsSchema = submissionParamsSchema;

/** Reject unknown JSON keys when a body is sent (empty object allowed). */
export const submitSubmissionBodySchema = z.object({}).strict();

export const getUserSubmissionsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
});

export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;
export type CreateSubmissionBody = z.infer<typeof createSubmissionBodySchema>;
export type SubmissionParams = z.infer<typeof submissionParamsSchema>;
export type SubmitSubmissionParams = z.infer<typeof submitSubmissionParamsSchema>;
export type GetUserSubmissionsQuery = z.infer<typeof getUserSubmissionsQuerySchema>;
