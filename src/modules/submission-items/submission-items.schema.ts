import { z } from "zod";

export const submissionParamsSchema = z.object({
  submissionId: z.string().uuid(),
});

export const submissionItemParamsSchema = z.object({
  submissionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const addSubmissionItemBodySchema = z.object({
  category: z.string().trim().min(1).max(120),
  subcategory: z.string().trim().max(120).optional(),
  activity_date: z.string().date().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  proposed_score: z.number().min(0).max(100000),
});

export const updateSubmissionItemBodySchema = z
  .object({
    category: z.string().trim().min(1).max(120).optional(),
    subcategory: z.string().trim().max(120).optional(),
    activity_date: z.string().date().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    proposed_score: z.number().min(0).max(100000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided for update",
  });

export const attachFileBodySchema = z.object({
  proof_file_url: z.string().url(),
});

export const addExternalLinkBodySchema = z.object({
  proof_file_url: z.string().url(),
});

export type AddSubmissionItemBody = z.infer<typeof addSubmissionItemBodySchema>;
export type UpdateSubmissionItemBody = z.infer<typeof updateSubmissionItemBodySchema>;
