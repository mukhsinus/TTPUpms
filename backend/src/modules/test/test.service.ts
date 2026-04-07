import type { FastifyInstance } from "fastify";
import { TestRepository } from "./test.repository";

export interface TestPayload {
  message: string;
  databaseNow: string;
}

export class TestService {
  private readonly repository: TestRepository;

  constructor(app: FastifyInstance) {
    this.repository = new TestRepository(app);
  }

  async runTestLogic(): Promise<TestPayload> {
    const dbInfo = await this.repository.getDbInfo();

    return {
      message: "Test module is working",
      databaseNow: dbInfo.databaseNow,
    };
  }
}
