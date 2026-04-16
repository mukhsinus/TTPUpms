import type { ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { RequireRole } from "./components/RequireRole";
import { RoleGuard } from "./components/guards/RoleGuard";
import { api } from "./lib/api";
import { isAdminPanelRole } from "./lib/rbac";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { AdminSubmissionDetailPage } from "./pages/AdminSubmissionDetailPage";
import { AdminSubmissionsPage } from "./pages/AdminSubmissionsPage";
import { SubmissionDetailPage } from "./pages/SubmissionDetailPage";
import { SubmissionsPage } from "./pages/SubmissionsPage";
import { CategoriesSettingsPage } from "./pages/CategoriesSettingsPage";
import { UsersPage } from "./pages/UsersPage";

function SubmissionsEntry(): ReactElement {
  return isAdminPanelRole(api.getSessionUser()) ? <AdminSubmissionsPage /> : <SubmissionsPage />;
}

function SubmissionDetailEntry(): ReactElement {
  return isAdminPanelRole(api.getSessionUser()) ? <AdminSubmissionDetailPage /> : <SubmissionDetailPage />;
}

function AuthenticatedShell({ onLogout }: { onLogout: () => void }): ReactElement {
  const user = api.getSessionUser();
  if (isAdminPanelRole(user)) {
    return (
      <AdminLayout onLogout={onLogout}>
        <Outlet />
      </AdminLayout>
    );
  }
  return (
    <AppLayout onLogout={onLogout}>
      <Outlet />
    </AppLayout>
  );
}

export default function App(): ReactElement {
  const handleLogout = (): void => {
    api.logout();
    window.location.assign("/login");
  };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AuthenticatedShell onLogout={handleLogout} />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/submissions" element={<SubmissionsEntry />} />
          <Route
            path="/reviews"
            element={
              <RequireRole roles={["admin", "superadmin", "reviewer"]}>
                <SubmissionsPage />
              </RequireRole>
            }
          />
          <Route path="/submissions/:submissionId" element={<SubmissionDetailEntry />} />
          <Route
            path="/analytics"
            element={
              <RequireRole roles={["admin", "superadmin", "reviewer"]}>
                <AnalyticsPage />
              </RequireRole>
            }
          />
          <Route
            path="/settings/categories"
            element={
              <RoleGuard allow={["admin", "superadmin"]} redirectTo="/dashboard">
                <CategoriesSettingsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/users"
            element={
              <RoleGuard allow={["admin", "superadmin"]} redirectTo="/dashboard">
                <UsersPage />
              </RoleGuard>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
