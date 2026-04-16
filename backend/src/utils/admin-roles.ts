import type { AppRole } from "../types/auth-user";

/** Roles that may call `/api/admin/*` and the moderation API surface. */
export function isAdminPanelOperator(role: string): role is "admin" | "superadmin" {
  return role === "admin" || role === "superadmin";
}

export function isPrivilegedStaff(role: string): boolean {
  return role === "admin" || role === "superadmin" || role === "reviewer";
}

export const ADMIN_PANEL_ROLES: readonly AppRole[] = ["admin", "superadmin"];
