import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { failure } from "../utils/http-response";
import { SystemPhaseService } from "../modules/system/system-phase.service";

const SUBMISSION_CLOSED_MESSAGE = "Submission phase has ended. Evaluation is in progress.";

export function studentSubmissionPhaseGuard(app: FastifyInstance) {
  const service = new SystemPhaseService(app);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user || request.user.role !== "student") {
      return;
    }
    const state = await service.getPhaseState();
    if (state.phase === "evaluation") {
      reply.status(403).send(failure(SUBMISSION_CLOSED_MESSAGE, "SUBMISSION_CLOSED", {}));
      return;
    }
  };
}

export function botStudentSubmissionPhaseGuard(app: FastifyInstance) {
  const service = new SystemPhaseService(app);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = request.body;
    if (typeof body !== "object" || body === null || !("telegram_id" in body)) {
      return;
    }
    const telegramId = (body as { telegram_id?: unknown }).telegram_id;
    if (typeof telegramId !== "string" || !/^\d+$/.test(telegramId)) {
      return;
    }
    const allowed = await service.shouldAllowBotStudentSubmission(telegramId);
    if (!allowed) {
      reply.status(403).send(failure(SUBMISSION_CLOSED_MESSAGE, "SUBMISSION_CLOSED", {}));
      return;
    }
  };
}
