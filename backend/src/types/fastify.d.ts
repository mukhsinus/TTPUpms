import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import type { JwtAuthIdentity } from "../middleware/auth.middleware";
import type { AuthUser } from "./auth-user";

interface AuthenticatedUser extends AuthUser {
  email: string | null;
}

interface IdempotencyContext {
  key: string;
  hash: string;
  scope: string;
  replayed: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
    supabaseAdmin: SupabaseClient;
  }

  interface FastifyRequest {
    user?: AuthenticatedUser;
    /** Supabase user fields needed for `/api/auth/me` sync (not used on hot path elsewhere). */
    authIdentity?: JwtAuthIdentity;
    /** Bot API: resolved `public.users.id` from `telegram_id` in body (idempotency + rate limits). */
    idempotencySubjectUserId?: string;
    idempotencyContext?: IdempotencyContext;
  }
}
