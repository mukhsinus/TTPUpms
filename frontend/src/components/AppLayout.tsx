import type { PropsWithChildren, ReactElement } from "react";
import { NavLink } from "react-router-dom";

interface AppLayoutProps extends PropsWithChildren {
  onLogout: () => void;
}

export function AppLayout({ children, onLogout }: AppLayoutProps): ReactElement {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="row-between">
          <h1>UPMS Admin</h1>
          <button className="button danger" onClick={onLogout} type="button">
            Logout
          </button>
        </div>
      </header>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav">
        <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
          Dashboard
        </NavLink>
        <NavLink to="/submissions" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
          Submissions
        </NavLink>
        <NavLink to="/users" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
          Users
        </NavLink>
      </nav>
    </div>
  );
}
