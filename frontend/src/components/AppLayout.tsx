import { BarChart3, ClipboardList, LayoutDashboard, LogOut, Search, ShieldCheck, X } from "lucide-react";
import { useMemo, useState, type PropsWithChildren, type ReactElement } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface AppLayoutProps extends PropsWithChildren {
  onLogout: () => void;
}

export function AppLayout({ children, onLogout }: AppLayoutProps): ReactElement {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const user = api.getSessionUser();
  const canAccessReviewerFeatures = user?.role === "admin" || user?.role === "reviewer";

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/submissions/")) return "Submission Detail";
    if (location.pathname.startsWith("/submissions")) return "Submissions";
    if (location.pathname.startsWith("/reviews")) return "Reviews";
    if (location.pathname.startsWith("/analytics")) return "Analytics";
    if (location.pathname.startsWith("/users")) return "Users";
    return "Dashboard";
  }, [location.pathname]);

  return (
    <div className="dashboard-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-logo">TTPU</div>
          <div>
            <strong>UPMS Admin</strong>
            <p>Achievement Management</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>
          <NavLink to="/submissions" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            <ClipboardList size={16} />
            Submissions
          </NavLink>
          {canAccessReviewerFeatures ? (
            <NavLink to="/reviews" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              <ShieldCheck size={16} />
              Reviews
            </NavLink>
          ) : null}
          {canAccessReviewerFeatures ? (
            <NavLink to="/analytics" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              <BarChart3 size={16} />
              Analytics
            </NavLink>
          ) : null}
        </nav>
        <div className="sidebar-user">
          <p className="user-name">{user?.fullName ?? user?.email ?? "Admin"}</p>
          <p className="user-role">{user?.role ?? "admin"}</p>
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
              <p>{new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
            </div>
          </div>
          <div className="top-header-right">
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
