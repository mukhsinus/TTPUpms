import { z } from "zod";
import { submissionStatusSchema } from "../submissions/submissions.schema";

export const adminSubmissionParamsSchema = z.object({
  submissionId: z.string().uuid(),
});

export const overrideScoreBodySchema = z.object({
  totalScore: z.number().min(0),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export const overrideStatusBodySchema = z.object({
  status: submissionStatusSchema,
  reason: z.string().trim().min(1).max(1000).optional(),
});

export type OverrideScoreBody = z.infer<typeof overrideScoreBodySchema>;
export type OverrideStatusBody = z.infer<typeof overrideStatusBodySchema>;
