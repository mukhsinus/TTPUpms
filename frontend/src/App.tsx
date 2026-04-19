import { lazy, Suspense, useEffect, type ReactElement } from "react";
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

const loadDashboardPage = async () => import("./pages/DashboardPage");
const loadAdminSubmissionsPage = async () => import("./pages/AdminSubmissionsPage");
const loadProfilePage = async () => import("./pages/ProfilePage");

const DashboardPage = lazy(async () => {
  const m = await loadDashboardPage();
  return { default: m.DashboardPage };
});
const AdminSubmissionsPage = lazy(async () => {
  const m = await loadAdminSubmissionsPage();
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
  const m = await loadProfilePage();
  return { default: m.ProfilePage };
});
const AdminsPage = lazy(async () => {
  const m = await import("./pages/AdminsPage");
  return { default: m.AdminsPage };
});
const AuditLogsPage = lazy(async () => {
  const m = await import("./pages/AuditLogsPage");
  return { default: m.AuditLogsPage };
});
const SecurityCenterPage = lazy(async () => {
  const m = await import("./pages/SecurityCenterPage");
  return { default: m.SecurityCenterPage };
});
const ReportsPage = lazy(async () => {
  const m = await import("./pages/ReportsPage");
  return { default: m.ReportsPage };
});

function SubmissionsEntry(): ReactElement {
  return isAdminPanelRole(api.getSessionUser()) ? <AdminSubmissionsPage /> : <SubmissionsPage />;
}

function SubmissionDetailEntry(): ReactElement {
  return isAdminPanelRole(api.getSessionUser()) ? <AdminSubmissionDetailPage /> : <SubmissionDetailPage />;
}

function AuthenticatedShell({ onLogout }: { onLogout: () => void }): ReactElement {
  const user = api.getSessionUser();
  useEffect(() => {
    if (!isAdminPanelRole(user)) {
      return;
    }
    const warm = (): void => {
      void loadDashboardPage();
      void loadAdminSubmissionsPage();
      void loadProfilePage();
      void api.getAdminDashboard({ page: 1, pageSize: 12 }).catch(() => undefined);
      void api.getAdminSubmissions({ page: 1, pageSize: 20 }).catch(() => undefined);
      void api.getAdminProfile({ page: 1, pageSize: 10 }).catch(() => undefined);
    };
    const browser = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: IdleRequestCallback) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof browser.requestIdleCallback === "function") {
      const handle = browser.requestIdleCallback(
        () => warm(),
      );
      return () => {
        browser.cancelIdleCallback?.(handle);
      };
    }
    const t = globalThis.setTimeout(warm, 120);
    return () => globalThis.clearTimeout(t);
  }, [user]);

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
            <Route
              path="/admins"
              element={
                <RoleGuard allow={["superadmin"]} redirectTo="/dashboard">
                  <AdminsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/audit"
              element={
                <RoleGuard allow={["superadmin"]} redirectTo="/dashboard">
                  <AuditLogsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/security"
              element={
                <RoleGuard allow={["superadmin"]} redirectTo="/dashboard">
                  <SecurityCenterPage />
                </RoleGuard>
              }
            />
            <Route
              path="/reports"
              element={
                <RoleGuard allow={["superadmin"]} redirectTo="/dashboard">
                  <ReportsPage />
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
