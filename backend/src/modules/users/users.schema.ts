import { z } from "zod";
import { normalizeStudentId } from "../../utils/student-id";

export const degreeSchema = z.enum(["bachelor", "master"]);

function phoneHasValidDigits(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasLeadingPlus ? `+${digits}` : digits;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(phoneHasValidDigits, { message: "phone must contain 9-15 digits" })
  .transform((v) => normalizePhone(v));

/** Profile fields; uniqueness is enforced only on student_id in the database (partial unique index). */
export const updateUserProfileBodySchema = z.object({
  student_full_name: z.string().trim().min(1).max(300),
  degree: degreeSchema,
  faculty: z.string().trim().min(1).max(200),
  student_id: z.string().trim().min(1).max(64).transform((v) => normalizeStudentId(v)),
  phone: phoneSchema.optional(),
});

export type UpdateUserProfileBody = z.infer<typeof updateUserProfileBodySchema>;
