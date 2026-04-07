import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";

type Role = "student" | "reviewer" | "admin";

interface AuthenticatedUser {
  id: string;
  email: string | null;
  role: Role;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
    supabaseAdmin: SupabaseClient;
  }

  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}
