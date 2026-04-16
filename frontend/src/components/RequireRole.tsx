import type { ReactElement, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { type AppRole, hasRole } from "../lib/rbac";

interface RequireRoleProps {
  roles: AppRole[];
  children: ReactNode;
  redirectTo?: string;
}

/**
 * Renders children only when the logged-in user has one of the allowed roles.
 * Uses `api.getSessionUser().role`, which prefers the server role from `/api/auth/me` over JWT claims.
 */
export function RequireRole({ roles, children, redirectTo = "/dashboard" }: RequireRoleProps): ReactElement {
  const user = api.getSessionUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!hasRole(user, ...roles)) {
    return <Navigate to={redirectTo} replace />;
  }
  return <>{children}</>;
}
