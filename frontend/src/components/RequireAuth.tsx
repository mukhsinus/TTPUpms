import type { ReactElement } from "react";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";

export function RequireAuth(): ReactElement {
  const location = useLocation();

  useEffect(() => {
    if (!api.isSessionValid()) {
      return;
    }
    if (!api.needsSessionRoleHydration()) {
      return;
    }
    // Keep shell render non-blocking; role updates land asynchronously.
    void api.syncSessionRoleFromServer().catch(() => undefined);
  }, []);

  if (!api.isSessionValid()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
