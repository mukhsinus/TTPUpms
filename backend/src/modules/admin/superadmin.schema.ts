import { z } from "zod";

export const superadminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(200).optional(),
});

export const superadminAdminIdParamsSchema = z.object({
  adminId: z.string().uuid(),
});

export const superadminRoleBodySchema = z.object({
  role: z.enum(["admin", "superadmin"]),
});

export const superadminStatusBodySchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().max(1000).optional(),
});

export const superadminResetPasswordBodySchema = z.object({
  temporaryPassword: z.string().trim().min(8).max(200).optional(),
});

export const superadminAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  adminId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  dateFrom: z.string().trim().min(1).optional(),
  dateTo: z.string().trim().min(1).optional(),
});

export const superadminSecurityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  type: z.enum(["new_device_login", "logout_others_request", "admin_registration"]).optional(),
  adminId: z.string().uuid().optional(),
});

export const superadminSecurityEventParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const superadminResolveSecurityBodySchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export const superadminActivityPdfQuerySchema = z
  .object({
    range: z.enum(["today", "last7", "thisMonth", "custom"]).default("last7"),
    from: z.string().trim().min(1).optional(),
    to: z.string().trim().min(1).optional(),
    adminId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.range !== "custom") {
      return;
    }
    if (!value.from || !value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom range requires both from and to",
      });
    }
  });

export const superadminSubmissionParamsSchema = z.object({
  submissionId: z.string().uuid(),
});

export const superadminAssignBodySchema = z.object({
  adminId: z.string().uuid(),
});

export const superadminNoteBodySchema = z.object({
  note: z.string().trim().min(1).max(4000),
});

export type SuperadminListQuery = z.infer<typeof superadminListQuerySchema>;
export type SuperadminAuditQuery = z.infer<typeof superadminAuditQuerySchema>;
export type SuperadminSecurityQuery = z.infer<typeof superadminSecurityQuerySchema>;
export type SuperadminActivityPdfQuery = z.infer<typeof superadminActivityPdfQuerySchema>;
