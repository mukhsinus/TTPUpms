import { z } from "zod";

export const reviewSubmissionParamsSchema = z.object({
  submissionId: z.string().uuid(),
});

export const reviewSubmissionItemParamsSchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const reviewItemBodySchema = z.object({
  score: z.number().min(0),
  comment: z.string().trim().max(5000).optional(),
  decision: z.enum(["approved", "rejected"]),
});

export const completeSubmissionReviewBodySchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_revision"]),
  comment: z.string().trim().max(5000).optional(),
});

export type ReviewItemBody = z.infer<typeof reviewItemBodySchema>;
export type CompleteSubmissionReviewBody = z.infer<typeof completeSubmissionReviewBodySchema>;
