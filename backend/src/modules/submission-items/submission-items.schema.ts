import { z } from "zod";

export const submissionItemParamsSchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const metadataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional();

export const addSubmissionItemBodySchema = z
  .object({
    category_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional(),
    proof_file_url: z
      .preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : String(v).trim()),
        z.string().min(1).max(2048).optional(),
      ),
    /** Validated in service (http/https only); empty string omitted. */
    external_link: z
      .preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : String(v).trim()),
        z.string().max(2048).optional(),
      ),
    /** Optional non-scoring metadata; scores are assigned by admins/reviewers only. */
    metadata: metadataSchema,
  });

export type AddSubmissionItemBody = z.infer<typeof addSubmissionItemBodySchema>;

/** POST /api/submission-items — submission id in body instead of URL. */
export const addSubmissionItemFlatBodySchema = addSubmissionItemBodySchema.extend({
  submission_id: z.string().uuid(),
});

export type AddSubmissionItemFlatBody = z.infer<typeof addSubmissionItemFlatBodySchema>;
