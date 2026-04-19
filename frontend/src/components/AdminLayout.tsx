import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  ShieldAlert,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState, type PropsWithChildren, type ReactElement } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { normalizeRole } from "../lib/rbac";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Button } from "./ui/Button";

interface AdminLayoutProps extends PropsWithChildren {
  onLogout: () => void;
}

/** Shell for admin / superadmin — moderation UI only (no student copy). */
export function AdminLayout({ children, onLogout }: AdminLayoutProps): ReactElement {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const user = api.getSessionUser();
  const role = normalizeRole(user?.role ?? "student");
  const isSuperadmin = role === "superadmin";

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/profile")) return "Profile";
    if (location.pathname.startsWith("/admins")) return "Admins";
    if (location.pathname.startsWith("/audit")) return "Audit Logs";
    if (location.pathname.startsWith("/security")) return "Security";
    if (location.pathname.startsWith("/reports")) return "Reports";
    if (location.pathname.startsWith("/submissions/")) return "Submission detail";
    if (location.pathname.startsWith("/submissions")) return "Submissions";
    return "Dashboard";
  }, [location.pathname]);

  const prefetchDashboard = (): void => {
    void api.getAdminDashboard({ page: 1, pageSize: 12 }).catch(() => undefined);
  };
  const prefetchSubmissions = (): void => {
    void api.getAdminSubmissions({ page: 1, pageSize: 20 }).catch(() => undefined);
  };
  const prefetchProfile = (): void => {
    void api.getAdminProfile({ page: 1, pageSize: 10 }).catch(() => undefined);
  };

  return (
    <div className="dashboard-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-logo">TTPU</div>
          <div>
            <strong>PMS Admin</strong>
            <p>Moderation & scoring</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavLink
            to="/dashboard"
            onMouseEnter={prefetchDashboard}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>
          <NavLink
            to="/submissions"
            onMouseEnter={prefetchSubmissions}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            <ClipboardList size={16} />
            Submissions
          </NavLink>
          <NavLink
            to="/profile"
            onMouseEnter={prefetchProfile}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            <UserCircle2 size={16} />
            Profile
          </NavLink>
          {isSuperadmin ? (
            <>
              <NavLink to="/admins" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <Users size={16} />
                Admins
              </NavLink>
              <NavLink to="/audit" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <FileText size={16} />
                Audit Logs
              </NavLink>
              <NavLink to="/security" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <ShieldAlert size={16} />
                Security
              </NavLink>
              <NavLink to="/reports" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <FileText size={16} />
                Reports
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="sidebar-user">
          <p className="user-name">{user?.fullName ?? user?.email ?? "User"}</p>
          <p className="user-role">{role}</p>
          <Button type="button" variant="ghost" className="logout-button" onClick={onLogout}>
            <LogOut size={16} />
            Logout
          </Button>
        </div>
      </aside>

      <div className="dashboard-content">
        <header className="top-header">
          <div className="top-header-left">
            <Button
              type="button"
              variant="ghost"
              className="mobile-menu-button"
              onClick={() => setSidebarOpen((value) => !value)}
            >
              {sidebarOpen ? <X size={18} /> : <LayoutDashboard size={18} />}
            </Button>
            <div>
              <h1>{pageTitle}</h1>
            </div>
          </div>
          <div className="top-header-right">
            <LanguageSwitcher />
          </div>
        </header>
        <main className="main-area">{children}</main>
      </div>
    </div>
  );
}
