import { BarChart3, ClipboardList, LayoutDashboard, LogOut, Search, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type PropsWithChildren, type ReactElement } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { canAccessReviewerRoutes, normalizeRole } from "../lib/rbac";
import { useSidebarDrawer } from "../hooks/useSidebarDrawer";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface AppLayoutProps extends PropsWithChildren {
  onLogout: () => void;
}

/** Student / reviewer portal shell (not the admin moderation layout). */
export function AppLayout({ children, onLogout }: AppLayoutProps): ReactElement {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const user = api.getSessionUser();
  const role = normalizeRole(user?.role ?? "student");
  const canAccessReviewerFeatures = canAccessReviewerRoutes(user);

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

  const brandTitle = role === "reviewer" ? "PMS Reviewer" : "Student Portal";
  const brandSubtitle = role === "student" ? "My achievements" : "Review & analytics";

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/submissions/")) return "Submission Detail";
    if (location.pathname.startsWith("/submissions")) return "Submissions";
    if (location.pathname.startsWith("/reviews")) return "Reviews";
    if (location.pathname.startsWith("/analytics")) return "Analytics";
    if (location.pathname.startsWith("/settings/categories")) return "Categories";
    if (location.pathname.startsWith("/users")) return "Users";
    return "Dashboard";
  }, [location.pathname]);

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
              <strong>{brandTitle}</strong>
              <p>{brandSubtitle}</p>
            </div>
          </div>
          {drawer.isMobileDrawer ? (
            <button type="button" className="sidebar-drawer-close" aria-label="Close menu" onClick={closeDrawer}>
              <X size={20} strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
        <nav id="app-sidebar-nav" className="sidebar-nav">
          <NavLink to="/dashboard" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>
          <NavLink to="/submissions" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            <ClipboardList size={16} />
            Submissions
          </NavLink>
          {canAccessReviewerFeatures ? (
            <NavLink to="/reviews" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              <ShieldCheck size={16} />
              Reviews
            </NavLink>
          ) : null}
          {canAccessReviewerFeatures ? (
            <NavLink to="/analytics" onClick={navClose} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              <BarChart3 size={16} />
              Analytics
            </NavLink>
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
              <p>
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>
          <div className="top-header-right">
            <LanguageSwitcher />
            <label className="search-shell">
              <Search size={16} />
              <Input placeholder="Quick search..." />
            </label>
            <div className="header-user-avatar">{(user?.fullName ?? user?.email ?? "A").charAt(0).toUpperCase()}</div>
          </div>
        </header>
        <main className="main-area">{children}</main>
      </div>
    </div>
  );
}
