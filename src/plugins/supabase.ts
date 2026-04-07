import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";

export async function registerSupabase(app: FastifyInstance): Promise<void> {
  const supabaseAdmin = createClient(env.SUPABASE_PROJECT_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  app.decorate("supabaseAdmin", supabaseAdmin);
}
