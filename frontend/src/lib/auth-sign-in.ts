import { getSupabaseBrowserClient } from "./supabase-client";
import { getSupabaseBrowserEnv } from "./supabase-env";
import { ApiError } from "./api-error";

const DEBUG_AUTH =
  import.meta.env.DEV || String(import.meta.env.VITE_DEBUG_AUTH ?? "").toLowerCase() === "true";

/** After the fast direct-fetch path, only one retry round for transient failures. */
const NETWORK_RETRY_COUNT = 1;
const MAX_SIGN_IN_ATTEMPTS = 1 + NETWORK_RETRY_COUNT;
const FETCH_FALLBACK_RETRIES = 2;

function logAuth(...args: unknown[]): void {
  if (DEBUG_AUTH) {
    console.log("[upms:auth]", ...args);
  }
}

function isLikelyNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("connection was lost") ||
    msg.includes("aborted") ||
    msg.includes("econnreset")
  );
}

interface GoTrueTokenResponse {
  access_token?: string;
  error_description?: string;
  msg?: string;
  error?: string;
}

/**
 * Direct GoTrue password grant — matches what `signInWithPassword` does internally.
 * Sends both `apikey` and `Authorization: Bearer <anon>` (required by Supabase Auth).
 */
export async function signInWithPasswordViaFetch(
  email: string,
  password: string,
): Promise<GoTrueTokenResponse> {
  const { url, anonKey } = getSupabaseBrowserEnv();
  const tokenUrl = `${url}/auth/v1/token?grant_type=password`;
  logAuth("fetch: POST", tokenUrl);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password }),
  });

  const rawText = await response.text();
  logAuth("fetch: status", response.status, "body_len", rawText.length);

  let payload: GoTrueTokenResponse | null = null;
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText) as GoTrueTokenResponse;
    } catch {
      payload = { msg: rawText };
    }
  }

  if (!response.ok || !payload?.access_token) {
    const desc =
      payload?.error_description ??
      payload?.error ??
      payload?.msg ??
      (rawText || response.statusText || "Auth request failed");
    const err = new ApiError(desc, response.status || 401);
    logAuth("fetch: auth error", desc);
    throw err;
  }

  return payload;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Password sign-in: single direct GoTrue fetch first (fastest), then Supabase JS with light retries,
 * then fetch fallback again for flaky networks.
 */
export async function signInWithSupabasePassword(email: string, password: string): Promise<string> {
  const { url } = getSupabaseBrowserEnv();
  logAuth("signIn start", { supabaseUrl: url, emailPrefix: `${email.slice(0, 2)}***` });

  try {
    const direct = await signInWithPasswordViaFetch(email, password);
    if (direct.access_token) {
      logAuth("signIn OK (direct fetch)");
      return direct.access_token;
    }
  } catch (e) {
    if (e instanceof ApiError && !isLikelyNetworkFailure(e)) {
      throw e;
    }
    logAuth("direct fetch failed; continuing with Supabase JS", e);
  }

  let lastNetworkError: unknown;

  for (let attempt = 1; attempt <= MAX_SIGN_IN_ATTEMPTS; attempt++) {
    logAuth(`signInWithPassword attempt ${attempt}/${MAX_SIGN_IN_ATTEMPTS}`);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        logAuth("signInWithPassword returned error", error.message, "status", error.status);
        if (isLikelyNetworkFailure(error) && attempt < MAX_SIGN_IN_ATTEMPTS) {
          lastNetworkError = error;
          await sleep(300 * attempt);
          continue;
        }
        throw new ApiError(error.message, typeof error.status === "number" ? error.status : 401);
      }

      const token = data.session?.access_token;
      if (!token) {
        throw new ApiError("No session returned from Supabase", 401);
      }
      logAuth("signInWithPassword OK");
      return token;
    } catch (caught) {
      logAuth("signInWithPassword threw", caught);
      if (caught instanceof ApiError) {
        throw caught;
      }
      if (isLikelyNetworkFailure(caught) && attempt < MAX_SIGN_IN_ATTEMPTS) {
        lastNetworkError = caught;
        await sleep(300 * attempt);
        continue;
      }
      if (isLikelyNetworkFailure(caught)) {
        lastNetworkError = caught;
        break;
      }
      const message = caught instanceof Error ? caught.message : "Login failed";
      throw new ApiError(message, 500);
    }
  }

  logAuth("client path exhausted; trying fetch fallback with GoTrue headers");
  for (let f = 1; f <= FETCH_FALLBACK_RETRIES; f++) {
    try {
      logAuth(`fetch fallback ${f}/${FETCH_FALLBACK_RETRIES}`);
      const payload = await signInWithPasswordViaFetch(email, password);
      if (payload.access_token) {
        logAuth("fetch fallback OK (token received)");
        return payload.access_token;
      }
    } catch (e) {
      logAuth("fetch fallback failed", e);
      if (e instanceof ApiError && !isLikelyNetworkFailure(e) && e.statusCode !== 0) {
        throw e;
      }
      if (f < FETCH_FALLBACK_RETRIES) {
        await sleep(400 * f);
      }
    }
  }

  const fallbackMsg =
    lastNetworkError instanceof Error
      ? lastNetworkError.message
      : "Could not reach Supabase Auth. Check VPN/firewall, URL (https://*.supabase.co), and Supabase dashboard URL configuration for this site origin.";
  throw new ApiError(fallbackMsg, 503);
}
