import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { validateSupabaseEnvForUi } from "../lib/supabase-env";

export function LoginPage(): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const supabaseEnv = validateSupabaseEnvForUi();

  useEffect(() => {
    if (api.isSessionValid()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    try {
      setLoading(true);
      if (import.meta.env.DEV) {
        console.log("[upms:auth] login submit", { email: `${email.slice(0, 2)}***` });
      }
      await api.loginWithCredentials(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error("[upms:auth] login failed", err);
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
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
        <p className="auth-subtitle">Sign in with your university account</p>
        <form className="auth-form" onSubmit={(event) => void onSubmit(event)}>
          <label>
            <span>Email</span>
            <Input
              type="email"
              placeholder="name@university.edu"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </Button>
        </form>
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
