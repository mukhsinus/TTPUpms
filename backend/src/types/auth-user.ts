export type AppRole = "student" | "reviewer" | "admin" | "superadmin";

/** RBAC identity shared across services (JWT adds `email` on the request). */
export interface AuthUser {
  id: string;
  role: AppRole;
}
