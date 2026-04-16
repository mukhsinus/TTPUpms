import type { ReactElement, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../../lib/api";
import { hasRole, type AppRole } from "../../lib/rbac";

interface RoleGuardProps {
  /** User must have one of these roles (after server role normalization). */
  allow: AppRole[];
  children: ReactNode;
  /** Where to send users who fail the check. */
  redirectTo?: string;
  /** When true, show a static message instead of redirecting. */
  showAccessDenied?: boolean;
}

/**
 * Restricts children to users whose `public.users.role` (via `api.getSessionUser()`)
 * matches one of `allow`. Used to keep the admin panel isolated from students.
 */
export function RoleGuard({
  allow,
  children,
  redirectTo = "/login",
  showAccessDenied = false,
}: RoleGuardProps): ReactElement {
  const user = api.getSessionUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const ok = hasRole(user, ...allow);
  if (!ok) {
    if (showAccessDenied) {
      return (
        <section className="auth-page">
          <p className="error">Access denied.</p>
        </section>
      );
    }
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
