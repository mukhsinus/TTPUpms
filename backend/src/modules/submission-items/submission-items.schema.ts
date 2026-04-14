import { z } from "zod";

export const submissionItemParamsSchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const metadataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional();

export const addSubmissionItemBodySchema = z
  .object({
    category_id: z.string().uuid(),
    /** Preferred: UUID of category_subcategories row. */
    subcategory_id: z.string().uuid().optional(),
    /** Legacy: slug matching category_subcategories.slug for this category. */
    subcategory: z.string().trim().max(200).optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional(),
    proof_file_url: z.string().url().optional(),
    external_link: z.string().url().optional(),
    /** For range/expert categories; for fixed categories use 0 or any placeholder (server replaces from rules). */
    proposed_score: z.number().min(0).max(100000).default(0),
    /** Dynamic inputs (place, ielts_band, duration_band, cert_track, …) matched against scoring_rules. */
    metadata: metadataSchema,
  })
  .superRefine((val, ctx) => {
    if (!val.subcategory_id && (val.subcategory === undefined || val.subcategory === "")) {
      ctx.addIssue({
        code: "custom",
        message: "Provide subcategory_id or non-empty subcategory slug",
        path: ["subcategory_id"],
      });
    }
  });

export type AddSubmissionItemBody = z.infer<typeof addSubmissionItemBodySchema>;

/** POST /api/submission-items — submission id in body instead of URL. */
export const addSubmissionItemFlatBodySchema = addSubmissionItemBodySchema.extend({
  submission_id: z.string().uuid(),
});

export type AddSubmissionItemFlatBody = z.infer<typeof addSubmissionItemFlatBodySchema>;
