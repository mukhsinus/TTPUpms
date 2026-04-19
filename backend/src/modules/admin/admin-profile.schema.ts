import { z } from "zod";

export const adminProfileQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const adminSessionHeaderSchema = z.object({
  "x-admin-session-id": z.string().trim().min(8).max(200).optional(),
});

export const approveSecurityEventParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const updateAdminIdentityBodySchema = z.object({
  full_name: z.string().trim().max(200).optional(),
  email: z.string().trim().email(),
});

export type AdminProfileQuery = z.infer<typeof adminProfileQuerySchema>;
