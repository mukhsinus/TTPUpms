import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export function LoginPage(): ReactElement {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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
      await api.login(token);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="stack auth-shell">
      <article className="card">
        <h2>Admin Login</h2>
        <p className="muted">Paste a valid Supabase JWT token to continue.</p>
        <form className="stack" onSubmit={(event) => void onSubmit(event)}>
          <textarea
            className="input"
            placeholder="Bearer token"
            value={token}
            rows={6}
            onChange={(event) => setToken(event.target.value)}
          />
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Checking token..." : "Login"}
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </article>
    </section>
  );
}
