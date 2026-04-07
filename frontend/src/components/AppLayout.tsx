import type { PropsWithChildren, ReactElement } from "react";
import { NavLink } from "react-router-dom";

export function AppLayout({ children }: PropsWithChildren): ReactElement {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>UPMS Admin</h1>
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
