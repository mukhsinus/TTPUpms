import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";

export function RequireAuth(): ReactElement {
  const location = useLocation();
  const [roleHydrated, setRoleHydrated] = useState(
    () => !api.isSessionValid() || !api.needsSessionRoleHydration(),
  );

  useEffect(() => {
    if (!api.isSessionValid()) {
      return;
    }
    if (!api.needsSessionRoleHydration()) {
      setRoleHydrated(true);
      return;
    }
    void api.syncSessionRoleFromServer().finally(() => {
      setRoleHydrated(true);
    });
  }, []);

  if (!api.isSessionValid()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!roleHydrated) {
    return (
      <div className="auth-page">
        <p className="muted">Loading session…</p>
      </div>
    );
  }

  return <Outlet />;
}
