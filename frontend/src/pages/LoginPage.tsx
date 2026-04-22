import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { validateSupabaseEnvForUi } from "../lib/supabase-env";
import { useToast } from "../contexts/ToastContext";

type AuthTab = "login" | "register";
type AuthNoticeTone = "info" | "success" | "warning";

const PASSWORD_MIN_LENGTH = 6;

export function LoginPage(): ReactElement {
  const [activeTab, setActiveTab] = useState<AuthTab>("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<{ tone: AuthNoticeTone; text: string } | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const supabaseEnv = validateSupabaseEnvForUi();
  const toast = useToast();

  const adminPanelLogin =
    searchParams.get("panel") === "admin" || searchParams.get("source") === "admin_panel";
  const emailPattern = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/, []);

  const loginValid = useMemo(
    () => emailPattern.test(loginEmail.trim()) && loginPassword.length >= PASSWORD_MIN_LENGTH,
    [emailPattern, loginEmail, loginPassword],
  );
  const registerValid = useMemo(
    () =>
      registerName.trim().length >= 2 &&
      emailPattern.test(registerEmail.trim()) &&
      registerPassword.length >= PASSWORD_MIN_LENGTH,
    [emailPattern, registerEmail, registerName, registerPassword],
  );

  useEffect(() => {
    if (api.isSessionValid()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const onLoginSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    try {
      setLoginLoading(true);
      await api.loginWithCredentials(
        loginEmail.trim(),
        loginPassword,
        adminPanelLogin ? { authSource: "admin_panel" } : undefined,
      );
      toast.success("Welcome back.");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Invalid credentials";
      setError(message);
      const normalized = message.toLowerCase();
      if (normalized.includes("pending superadmin approval")) {
        setAuthNotice({
          tone: "warning",
          text: "Your request is under review by superadmin. Access will unlock right after approval.",
        });
      } else if (normalized.includes("rejected by superadmin")) {
        setAuthNotice({
          tone: "warning",
          text: "This admin account was rejected by superadmin and cannot access the admin panel.",
        });
      }
      toast.error(message);
    } finally {
      setLoginLoading(false);
    }
  };

  const onRegisterSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    try {
      setRegisterLoading(true);
      await api.registerAdminAccount({
        fullName: registerName,
        email: registerEmail,
        password: registerPassword,
      });
      toast.success("Registration request sent");
      setActiveTab("login");
      setLoginEmail(registerEmail.trim());
      setLoginPassword("");
      setRegisterPassword("");
      setAuthNotice({
        tone: "success",
        text: "Your admin request is submitted. You can sign in after superadmin approval.",
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Account creation failed";
      setError(message);
      toast.error(message);
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <section className="auth-page">
      <Card className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">TTPU</div>
          <div>
            <h1>PMS Portal</h1>
            <p className="ui-card-subtitle">Turin Polytechnic University in Tashkent</p>
          </div>
        </div>
        <p className="auth-subtitle">
          {adminPanelLogin
            ? "Admin panel — only allowlisted operator accounts can access moderation."
            : "Sign in with your university account"}
        </p>
        {adminPanelLogin ? (
          <div className={`auth-notice ${authNotice?.tone === "warning" ? "auth-notice-warning" : "auth-notice-info"}`}>
            <strong>Approval flow:</strong> New admin accounts become active only after superadmin confirmation.
          </div>
        ) : null}
        {authNotice ? (
          <div
            className={`auth-notice ${
              authNotice.tone === "success"
                ? "auth-notice-success"
                : authNotice.tone === "warning"
                  ? "auth-notice-warning"
                  : "auth-notice-info"
            }`}
            role="status"
            aria-live="polite"
          >
            {authNotice.text}
          </div>
        ) : null}
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "login"}
            className={`auth-tab-btn ${activeTab === "login" ? "active" : ""}`.trim()}
            onClick={() => {
              setActiveTab("login");
              setError(null);
            }}
          >
            Login
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "register"}
            className={`auth-tab-btn ${activeTab === "register" ? "active" : ""}`.trim()}
            onClick={() => {
              setActiveTab("register");
              setError(null);
            }}
          >
            Register
          </button>
        </div>
        <div className={`auth-panel auth-panel-${activeTab}`}>
          {activeTab === "login" ? (
            <form className="auth-form" onSubmit={(event) => void onLoginSubmit(event)}>
              <label>
                <span>Email</span>
                <Input
                  type="email"
                  placeholder="name@university.edu"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Password</span>
                <div className="auth-password-wrap">
                  <input
                    className="ui-input auth-password-input"
                    type={showLoginPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    aria-label={showLoginPassword ? "Hide password" : "Show password"}
                  >
                    {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
              <Button type="submit" disabled={loginLoading || !loginValid}>
                {loginLoading ? "Signing in..." : "Sign In"}
              </Button>
              <p className="auth-switch-note">
                Need an account?{" "}
                <button type="button" onClick={() => setActiveTab("register")}>
                  Register
                </button>
              </p>
            </form>
          ) : (
            <form className="auth-form" onSubmit={(event) => void onRegisterSubmit(event)}>
              <label>
                <span>Full Name</span>
                <Input
                  type="text"
                  placeholder="Mukhsin Kamolov"
                  value={registerName}
                  onChange={(event) => setRegisterName(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Email</span>
                <Input
                  type="email"
                  placeholder="name@university.edu"
                  value={registerEmail}
                  onChange={(event) => setRegisterEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Password</span>
                <div className="auth-password-wrap">
                  <input
                    className="ui-input auth-password-input"
                    type={showRegisterPassword ? "text" : "password"}
                    placeholder="Minimum 6 characters"
                    value={registerPassword}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowRegisterPassword((prev) => !prev)}
                    aria-label={showRegisterPassword ? "Hide password" : "Show password"}
                  >
                    {showRegisterPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
              <Button type="submit" disabled={registerLoading || !registerValid}>
                {registerLoading ? "Creating..." : "Create Account"}
              </Button>
              <p className="auth-switch-note">
                Already have account?{" "}
                <button type="button" onClick={() => setActiveTab("login")}>
                  Login
                </button>
              </p>
            </form>
          )}
        </div>
        {error ? <p className="error">{error}</p> : null}
        {!supabaseEnv.ok ? (
          <p className="muted">
            Supabase env: <code>{supabaseEnv.issues.join(" ")}</code>
          </p>
        ) : null}
      </Card>
    </section>
  );
}
