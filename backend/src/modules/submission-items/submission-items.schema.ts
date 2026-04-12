import { z } from "zod";

export const submissionItemParamsSchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const addSubmissionItemBodySchema = z.object({
  category_id: z.string().uuid(),
  subcategory: z.string().trim().max(200).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  proof_file_url: z.string().url().optional(),
  external_link: z.string().url().optional(),
  proposed_score: z.number().min(0).max(100000),
});

export type AddSubmissionItemBody = z.infer<typeof addSubmissionItemBodySchema>;
