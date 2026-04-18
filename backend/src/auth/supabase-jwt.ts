import * as jose from "jose";
import type { AppRole } from "../types/auth-user";

export interface VerifiedJwtIdentity {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

function toRole(value: unknown): AppRole | null {
  if (value === "admin" || value === "reviewer" || value === "student" || value === "superadmin") {
    return value;
  }
  return null;
}

/**
 * Verifies Supabase-issued access tokens (HS256) locally — no HTTP round-trip to GoTrue.
 * Set `SUPABASE_JWT_SECRET` from Supabase Dashboard → Settings → API → JWT Secret.
 */
export async function verifySupabaseAccessToken(
  token: string,
  jwtSecret: string,
): Promise<{ identity: VerifiedJwtIdentity; role: AppRole } | null> {
  try {
    const key = new TextEncoder().encode(jwtSecret);
    const { payload } = await jose.jwtVerify(token, key, {
      algorithms: ["HS256"],
    });

    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      return null;
    }

    const appMeta = (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
    const userMeta = (payload.user_metadata as Record<string, unknown> | undefined) ?? {};
    const jwtRoleParsed = toRole(appMeta.role);

    const role: AppRole = jwtRoleParsed ?? "student";

    const identity: VerifiedJwtIdentity = {
      id: sub,
      email: typeof payload.email === "string" ? payload.email : null,
      user_metadata: Object.keys(userMeta).length ? userMeta : undefined,
    };

    return { identity, role };
  } catch {
    return null;
  }
}
