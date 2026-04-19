import { lazy, Suspense, type ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { AppLayout } from "./components/AppLayout";
import { PageLoading } from "./components/PageLoading";
import { RequireAuth } from "./components/RequireAuth";
import { RequireRole } from "./components/RequireRole";
import { RoleGuard } from "./components/guards/RoleGuard";
import { api } from "./lib/api";
import { isAdminPanelRole } from "./lib/rbac";
import { LoginPage } from "./pages/LoginPage";

const DashboardPage = lazy(async () => {
  const m = await import("./pages/DashboardPage");
  return { default: m.DashboardPage };
});
const AdminSubmissionsPage = lazy(async () => {
  const m = await import("./pages/AdminSubmissionsPage");
  return { default: m.AdminSubmissionsPage };
});
const AdminSubmissionDetailPage = lazy(async () => {
  const m = await import("./pages/AdminSubmissionDetailPage");
  return { default: m.AdminSubmissionDetailPage };
});
const SubmissionsPage = lazy(async () => {
  const m = await import("./pages/SubmissionsPage");
  return { default: m.SubmissionsPage };
});
const SubmissionDetailPage = lazy(async () => {
  const m = await import("./pages/SubmissionDetailPage");
  return { default: m.SubmissionDetailPage };
});
const AnalyticsPage = lazy(async () => {
  const m = await import("./pages/AnalyticsPage");
  return { default: m.AnalyticsPage };
});
const CategoriesSettingsPage = lazy(async () => {
  const m = await import("./pages/CategoriesSettingsPage");
  return { default: m.CategoriesSettingsPage };
});
const UsersPage = lazy(async () => {
  const m = await import("./pages/UsersPage");
  return { default: m.UsersPage };
});
const ProfilePage = lazy(async () => {
  const m = await import("./pages/ProfilePage");
  return { default: m.ProfilePage };
});

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
    <Suspense fallback={<PageLoading />}>
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
              path="/profile"
              element={
                <RoleGuard allow={["admin", "superadmin"]} redirectTo="/dashboard">
                  <ProfilePage />
                </RoleGuard>
              }
            />
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
    </Suspense>
  );
}
