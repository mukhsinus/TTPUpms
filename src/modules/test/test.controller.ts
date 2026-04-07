import type { FastifyReply, FastifyRequest } from "fastify";
import type { TestService } from "./test.service";

export class TestController {
  constructor(private readonly service: TestService) {}

  getTest = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const payload = await this.service.runTestLogic();

    reply.status(200).send({
      success: true,
      data: payload,
    });
  };
}
