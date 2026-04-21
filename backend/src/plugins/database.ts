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

  // Prevent process crashes when idle pooled connections emit transport errors
  // (e.g. transient network/EADDRNOTAVAIL/timeout from managed DB).
  pool.on("error", (error) => {
    app.log.error({ err: error }, "Postgres pool emitted client error");
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
