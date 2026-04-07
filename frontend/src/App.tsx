import type { ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { api } from "./lib/api";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { SubmissionDetailPage } from "./pages/SubmissionDetailPage";
import { SubmissionsPage } from "./pages/SubmissionsPage";
import { UsersPage } from "./pages/UsersPage";

export default function App(): ReactElement {
  const handleLogout = (): void => {
    api.logout();
    window.location.assign("/login");
  };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route
          element={
            <AppLayout onLogout={handleLogout}>
              <Outlet />
            </AppLayout>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/submissions" element={<SubmissionsPage />} />
          <Route path="/reviews" element={<SubmissionsPage />} />
          <Route path="/submissions/:submissionId" element={<SubmissionDetailPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/users" element={<UsersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
