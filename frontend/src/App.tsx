import { lazy, Suspense, useEffect, useRef, type ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { AppLayout } from "./components/AppLayout";
import { PageLoading } from "./components/PageLoading";
import { RequireAuth } from "./components/RequireAuth";
import { RequireRole } from "./components/RequireRole";
import { RoleGuard } from "./components/guards/RoleGuard";
import { api } from "./lib/api";
import { emitRealtimeUpdate } from "./lib/realtime-events";
import { isAdminPanelRole } from "./lib/rbac";
import { LoginPage } from "./pages/LoginPage";

const loadDashboardPage = async () => import("./pages/DashboardPage");
const loadAdminSubmissionsPage = async () => import("./pages/AdminSubmissionsPage");
const loadProfilePage = async () => import("./pages/ProfilePage");
const loadAdminsPage = async () => import("./pages/AdminsPage");
const loadAuditLogsPage = async () => import("./pages/AuditLogsPage");
const loadSecurityCenterPage = async () => import("./pages/SecurityCenterPage");
const loadReportsPage = async () => import("./pages/ReportsPage");

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
const AdminSubmissionGroupPage = lazy(async () => {
  const m = await import("./pages/AdminSubmissionGroupPage");
  return { default: m.AdminSubmissionGroupPage };
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
  const m = await loadAdminsPage();
  return { default: m.AdminsPage };
});
const AuditLogsPage = lazy(async () => {
  const m = await loadAuditLogsPage();
  return { default: m.AuditLogsPage };
});
const SecurityCenterPage = lazy(async () => {
  const m = await loadSecurityCenterPage();
  return { default: m.SecurityCenterPage };
});
const ReportsPage = lazy(async () => {
  const m = await loadReportsPage();
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
  const countersRef = useRef<{
    submissionsTotal: number | null;
    studentsTotal: number | null;
    adminsTotal: number | null;
  }>({
    submissionsTotal: null,
    studentsTotal: null,
    adminsTotal: null,
  });
  useEffect(() => {
    if (!isAdminPanelRole(user)) {
      return;
    }
    const warm = (): void => {
      void loadDashboardPage();
      void loadAdminSubmissionsPage();
      void loadProfilePage();
      if (user?.role === "superadmin") {
        void loadAdminsPage();
        void loadAuditLogsPage();
        void loadSecurityCenterPage();
        void loadReportsPage();
      }
      void api.getAdminDashboard({ page: 1, pageSize: 12 }).catch(() => undefined);
      void api.getAdminSubmissions({ page: 1, pageSize: 7 }).catch(() => undefined);
      void api.getAdminProfile({ page: 1, pageSize: 5 }).catch(() => undefined);
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

  useEffect(() => {
    if (!isAdminPanelRole(user)) {
      countersRef.current = { submissionsTotal: null, studentsTotal: null, adminsTotal: null };
      return;
    }
    let cancelled = false;
    const poll = async (isInitial: boolean): Promise<void> => {
      try {
        const [submissions, students, admins] = await Promise.all([
          api.getAdminSubmissions({ page: 1, pageSize: 1, forceRefresh: true }),
          api.getAdminStudents({ page: 1, pageSize: 1, forceRefresh: true }),
          user?.role === "superadmin"
            ? api.getSuperadminAdmins({ page: 1, pageSize: 1, forceRefresh: true })
            : Promise.resolve(null),
        ]);
        if (cancelled) return;

        const previous = countersRef.current;
        const next = {
          submissionsTotal: submissions.total,
          studentsTotal: students.pagination.total,
          adminsTotal: admins?.pagination.total ?? previous.adminsTotal,
        };

        if (!isInitial) {
          if (previous.submissionsTotal !== null && next.submissionsTotal > previous.submissionsTotal) {
            emitRealtimeUpdate("new_submission");
          }
          if (previous.studentsTotal !== null && next.studentsTotal > previous.studentsTotal) {
            emitRealtimeUpdate("new_student");
          }
          if (
            user?.role === "superadmin" &&
            previous.adminsTotal !== null &&
            next.adminsTotal !== null &&
            next.adminsTotal > previous.adminsTotal
          ) {
            emitRealtimeUpdate("new_admin");
          }
        }

        countersRef.current = next;
      } catch {
        // Ignore polling errors; UI keeps using manual refresh and user actions.
      }
    };

    void poll(true);
    const timer = globalThis.setInterval(() => {
      void poll(false);
    }, 15_000);

    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [user?.role, user?.userId]);

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
              path="/submissions/groups/:groupKey"
              element={
                <RoleGuard allow={["admin", "superadmin", "reviewer"]} redirectTo="/dashboard">
                  <AdminSubmissionGroupPage />
                </RoleGuard>
              }
            />
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
