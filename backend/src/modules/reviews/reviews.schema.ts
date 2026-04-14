import { z } from "zod";

export const reviewSubmissionParamsSchema = z.object({
  submissionId: z.string().uuid(),
});

export const reviewSubmissionItemParamsSchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const patchReviewItemParamsSchema = z.object({
  itemId: z.string().uuid(),
});

/** Legacy shape; prefer approved_score + status + reviewer_comment on PATCH. */
export const reviewItemBodySchema = z.object({
  score: z.number().min(0),
  comment: z.string().trim().max(5000).optional(),
  decision: z.enum(["approved", "rejected"]),
});

const reviewItemBodyFlexibleSchema = z.object({
  score: z.number().min(0).optional(),
  approved_score: z.number().min(0).optional(),
  decision: z.enum(["approved", "rejected"]).optional(),
  status: z.enum(["approved", "rejected"]).optional(),
  comment: z.string().trim().max(5000).optional(),
  reviewer_comment: z.string().trim().max(5000).optional(),
});

export type ReviewItemBody = {
  score?: number;
  decision: "approved" | "rejected";
  comment?: string;
};

/** Normalizes flexible field names to ReviewItemBody. Score may be omitted for fixed categories (rule-based). */
export function parseReviewItemBody(body: unknown): ReviewItemBody {
  const raw = reviewItemBodyFlexibleSchema.parse(body);
  const score = raw.approved_score ?? raw.score;
  const decision = raw.status ?? raw.decision;
  const comment = raw.reviewer_comment ?? raw.comment;
  if (decision === undefined) {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Provide decision or status",
      },
    ]);
  }
  if (score !== undefined && !Number.isFinite(score)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["score"],
        message: "Score must be a finite number",
      },
    ]);
  }
  return { score, decision, comment };
}

export const completeSubmissionReviewBodySchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_revision"]),
  comment: z.string().trim().max(5000).optional(),
});

export type CompleteSubmissionReviewBody = z.infer<typeof completeSubmissionReviewBodySchema>;
