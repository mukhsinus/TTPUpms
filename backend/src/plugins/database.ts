import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { env } from "../config/env";

export async function registerDatabase(app: FastifyInstance): Promise<void> {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    app.log.error({ err: error }, "Database initialization failed");
    await pool.end();
    throw new Error("Database connection failed");
  }

  app.decorate("db", pool);

  app.addHook("onClose", async () => {
    await pool.end();
  });
}
