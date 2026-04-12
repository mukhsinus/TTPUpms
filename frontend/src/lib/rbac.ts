export type AppRole = "student" | "reviewer" | "admin";

const ROLES: readonly AppRole[] = ["student", "reviewer", "admin"];

export function normalizeRole(role: string): AppRole {
  return ROLES.includes(role as AppRole) ? (role as AppRole) : "student";
}

export function hasRole(user: { role: string } | null | undefined, ...roles: AppRole[]): boolean {
  if (!user) return false;
  return roles.includes(normalizeRole(user.role));
}

/** Review panel, analytics, and `/reviews` queue. */
export function canAccessReviewerRoutes(user: { role: string } | null | undefined): boolean {
  return hasRole(user, "admin", "reviewer");
}

export function isAdminRole(user: { role: string } | null | undefined): boolean {
  return hasRole(user, "admin");
}
