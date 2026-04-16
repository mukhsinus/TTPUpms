import { z } from "zod";

export const degreeSchema = z.enum(["bachelor", "master"]);

/** Profile fields; uniqueness is enforced only on student_id in the database (partial unique index). */
export const updateUserProfileBodySchema = z.object({
  student_full_name: z.string().trim().min(1).max(300),
  degree: degreeSchema,
  faculty: z.string().trim().min(1).max(200),
  student_id: z.string().trim().min(1).max(64),
});

export type UpdateUserProfileBody = z.infer<typeof updateUserProfileBodySchema>;
