const PROJECT_HOST = /^[a-z0-9-]+\.supabase\.co$/i;

export interface SupabaseBrowserEnv {
  /** Normalized `https://<ref>.supabase.co` (no trailing slash, no path) */
  url: string;
  anonKey: string;
}

function looksLikePlaceholder(value: string): boolean {
  const v = value.toLowerCase();
  return (
    v.length < 40 ||
    /\s/.test(value) ||
    /your[_-]?anon|your[_-]?key|replace[-_]with|changeme|example|xxx+/.test(v)
  );
}

/**
 * Validates and normalizes browser Supabase settings.
 * GoTrue must use the project REST host (`*.supabase.co`), not a DB pooler URL.
 */
export function getSupabaseBrowserEnv(): SupabaseBrowserEnv {
  const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

  if (!rawUrl) {
    throw new Error("VITE_SUPABASE_URL is missing");
  }
  if (!anonKey) {
    throw new Error("VITE_SUPABASE_ANON_KEY is missing");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid URL, e.g. https://abcd1234.supabase.co");
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      "VITE_SUPABASE_URL must use https:// — use https://<project-ref>.supabase.co for browser auth",
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (!PROJECT_HOST.test(host)) {
    throw new Error(
      "VITE_SUPABASE_URL host must be <project-ref>.supabase.co (not a Postgres pooler hostname)",
    );
  }

  if (looksLikePlaceholder(anonKey)) {
    throw new Error("VITE_SUPABASE_ANON_KEY is missing or looks like a placeholder");
  }

  const url = `https://${host}`;
  return { url, anonKey };
}

export function validateSupabaseEnvForUi(): { ok: boolean; issues: string[] } {
  try {
    getSupabaseBrowserEnv();
    return { ok: true, issues: [] };
  } catch (e) {
    return { ok: false, issues: [e instanceof Error ? e.message : "Invalid Supabase env"] };
  }
}
