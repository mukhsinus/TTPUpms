import type { FastifyInstance } from "fastify";

export interface TestDbInfo {
  databaseNow: string;
}

export class TestRepository {
  constructor(private readonly app: FastifyInstance) {}

  async getDbInfo(): Promise<TestDbInfo> {
    const result = await this.app.db.query<{ database_now: string }>(
      "SELECT NOW()::text AS database_now",
    );

    return {
      databaseNow: result.rows[0]?.database_now ?? "",
    };
  }
}
