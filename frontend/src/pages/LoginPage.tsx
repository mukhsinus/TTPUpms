import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

function getMissingSupabaseEnvVars(): string[] {
  const missing: string[] = [];
  if (!import.meta.env.VITE_SUPABASE_URL) {
    missing.push("VITE_SUPABASE_URL");
  }
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
    missing.push("VITE_SUPABASE_ANON_KEY");
  }
  return missing;
}

export function LoginPage(): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const missingEnvVars = getMissingSupabaseEnvVars();

  useEffect(() => {
    if (api.isLoggedIn()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    try {
      setLoading(true);
      await api.loginWithCredentials(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="auth-page">
      <Card className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">TPU</div>
          <div>
            <h1>UPMS Admin</h1>
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
        {missingEnvVars.length > 0 ? (
          <p className="muted">
            Missing frontend env: <code>{missingEnvVars.join(", ")}</code>
          </p>
        ) : null}
      </Card>
    </section>
  );
}
