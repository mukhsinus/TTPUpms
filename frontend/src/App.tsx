import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { SubmissionDetailPage } from "./pages/SubmissionDetailPage";
import { SubmissionsPage } from "./pages/SubmissionsPage";
import { UsersPage } from "./pages/UsersPage";

export default function App(): ReactElement {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/submissions" element={<SubmissionsPage />} />
        <Route path="/submissions/:submissionId" element={<SubmissionDetailPage />} />
        <Route path="/users" element={<UsersPage />} />
      </Routes>
    </AppLayout>
  );
}
