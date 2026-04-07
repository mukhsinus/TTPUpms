import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";

export function RequireAuth(): ReactElement {
  const location = useLocation();

  if (!api.isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
