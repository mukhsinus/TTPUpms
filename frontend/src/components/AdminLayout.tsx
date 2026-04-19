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
import { useCallback, useEffect, useMemo, useState, type PropsWithChildren, type ReactElement } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { normalizeRole } from "../lib/rbac";
import { useSidebarDrawer } from "../hooks/useSidebarDrawer";
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

  const closeDrawer = useCallback(() => setSidebarOpen(false), []);
  const drawer = useSidebarDrawer(sidebarOpen, closeDrawer);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawer.isMobileDrawer) {
      setSidebarOpen(false);
    }
  }, [drawer.isMobileDrawer]);

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

  const navClose = drawer.isMobileDrawer ? closeDrawer : undefined;

  return (
    <div className="dashboard-shell">
      {drawer.isMobileDrawer ? (
        <button
          type="button"
          className={`sidebar-drawer-backdrop${sidebarOpen ? " sidebar-drawer-backdrop--open" : ""}`}
          aria-label="Close navigation menu"
          tabIndex={-1}
          onClick={closeDrawer}
        />
      ) : null}
      <aside
        ref={drawer.asideRef}
        className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}
        aria-hidden={drawer.isMobileDrawer ? !sidebarOpen : undefined}
        aria-modal={drawer.isMobileDrawer && sidebarOpen ? true : undefined}
        role={drawer.isMobileDrawer && sidebarOpen ? "dialog" : undefined}
        aria-label={drawer.isMobileDrawer && sidebarOpen ? "Main navigation" : undefined}
        inert={drawer.isMobileDrawer && !sidebarOpen ? true : undefined}
        {...(drawer.isMobileDrawer ? drawer.touchHandlers : {})}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-text">
            <div className="brand-logo">TTPU</div>
            <div>
              <strong>PMS Admin</strong>
              <p>Moderation & scoring</p>
            </div>
          </div>
          {drawer.isMobileDrawer ? (
            <button
              type="button"
              className="sidebar-drawer-close"
              aria-label="Close menu"
              onClick={closeDrawer}
            >
              <X size={20} strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
        <nav id="app-sidebar-nav" className="sidebar-nav">
          <NavLink
            to="/dashboard"
            onMouseEnter={prefetchDashboard}
            onClick={navClose}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>
          <NavLink
            to="/submissions"
            onMouseEnter={prefetchSubmissions}
            onClick={navClose}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            <ClipboardList size={16} />
            Submissions
          </NavLink>
          <NavLink
            to="/profile"
            onMouseEnter={prefetchProfile}
            onClick={navClose}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            <UserCircle2 size={16} />
            Profile
          </NavLink>
          {isSuperadmin ? (
            <>
              <NavLink to="/admins" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <Users size={16} />
                Admins
              </NavLink>
              <NavLink to="/audit" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <FileText size={16} />
                Audit Logs
              </NavLink>
              <NavLink to="/security" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <ShieldAlert size={16} />
                Security
              </NavLink>
              <NavLink to="/reports" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <FileText size={16} />
                Reports
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="sidebar-user">
          <p className="user-name">{user?.fullName ?? user?.email ?? "User"}</p>
          <p className="user-role">{role}</p>
          <Button
            type="button"
            variant="ghost"
            className="logout-button"
            onClick={() => {
              navClose?.();
              onLogout();
            }}
          >
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
              aria-expanded={drawer.isMobileDrawer ? sidebarOpen : undefined}
              aria-controls={drawer.isMobileDrawer ? "app-sidebar-nav" : undefined}
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
