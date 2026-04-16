export type AppRole = "student" | "reviewer" | "admin" | "superadmin";

const ROLES: readonly AppRole[] = ["student", "reviewer", "admin", "superadmin"];

export function normalizeRole(role: string): AppRole {
  return ROLES.includes(role as AppRole) ? (role as AppRole) : "student";
}

export function hasRole(user: { role: string } | null | undefined, ...roles: AppRole[]): boolean {
  if (!user) return false;
  return roles.includes(normalizeRole(user.role));
}

/** Review panel, analytics, and `/reviews` queue (includes elevated staff). */
export function canAccessReviewerRoutes(user: { role: string } | null | undefined): boolean {
  return hasRole(user, "admin", "superadmin", "reviewer");
}

/** Admin moderation panel (`/api/admin/*` and admin UI). */
export function isAdminPanelRole(user: { role: string } | null | undefined): boolean {
  return hasRole(user, "admin", "superadmin");
}

/** @alias — same as {@link isAdminPanelRole} */
export function isAdminRole(user: { role: string } | null | undefined): boolean {
  return isAdminPanelRole(user);
}
