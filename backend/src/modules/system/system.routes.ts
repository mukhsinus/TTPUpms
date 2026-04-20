import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { failure, success } from "../../utils/http-response";
import { ServiceError } from "../../utils/service-error";
import { SystemPhaseService } from "./system-phase.service";
import type { ProjectPhase } from "./system-phase.types";

const updatePhaseBodySchema = z
  .object({
    phase: z.enum(["submission", "evaluation"]),
  })
  .strict();

const updateDeadlinesBodySchema = z
  .object({
    submissionDeadline: z.string().datetime().nullable().optional(),
    evaluationDeadline: z.string().datetime().nullable().optional(),
  })
  .strict();

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  const service = new SystemPhaseService(app);

  const sendPhaseState = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const state = await service.getPhaseState();
    reply.send(
      success({
        phase: state.phase,
        submissionDeadline: state.submissionDeadline,
        evaluationDeadline: state.evaluationDeadline,
        lastChangedBy: state.lastChangedByUserId
          ? {
              userId: state.lastChangedByUserId,
              name: state.lastChangedByName,
              email: state.lastChangedByEmail,
            }
          : null,
        lastChangedAt: state.lastChangedAt,
      }),
    );
  };

  app.get("/phase", sendPhaseState);
  app.get("/system/phase", sendPhaseState);

  app.patch(
    "/admin/system/phase",
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      if (!request.user) {
        reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
        return;
      }
      const parsed = updatePhaseBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send(failure(parsed.error.issues[0]?.message ?? "Validation error", "VALIDATION_ERROR", {}));
        return;
      }
      let state;
      try {
        state = await service.setPhase({
          phase: parsed.data.phase as ProjectPhase,
          actorUserId: request.user.id,
          requestIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      } catch (error) {
        if (error instanceof ServiceError) {
          reply.status(error.statusCode).send(failure(error.message, error.clientCode ?? "VALIDATION_ERROR", {}));
          return;
        }
        throw error;
      }
      reply.send(
        success({
          phase: state.phase,
          submissionDeadline: state.submissionDeadline,
          evaluationDeadline: state.evaluationDeadline,
          lastChangedBy: state.lastChangedByUserId
            ? {
                userId: state.lastChangedByUserId,
                name: state.lastChangedByName,
                email: state.lastChangedByEmail,
              }
            : null,
          lastChangedAt: state.lastChangedAt,
        }),
      );
    },
  );

  app.patch(
    "/admin/system/deadlines",
    { preHandler: [authMiddleware, requireAdmin] },
    async (request, reply) => {
      if (!request.user) {
        reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
        return;
      }
      const parsed = updateDeadlinesBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send(failure(parsed.error.issues[0]?.message ?? "Validation error", "VALIDATION_ERROR", {}));
        return;
      }
      let state;
      try {
        const current = await service.getPhaseState();
        state = await service.setDeadlines({
          submissionDeadline:
            parsed.data.submissionDeadline === undefined
              ? current.submissionDeadline
              : parsed.data.submissionDeadline,
          evaluationDeadline:
            parsed.data.evaluationDeadline === undefined
              ? current.evaluationDeadline
              : parsed.data.evaluationDeadline,
          actorUserId: request.user.id,
          requestIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      } catch (error) {
        if (error instanceof ServiceError) {
          reply.status(error.statusCode).send(failure(error.message, error.clientCode ?? "VALIDATION_ERROR", {}));
          return;
        }
        throw error;
      }
      reply.send(
        success({
          phase: state.phase,
          submissionDeadline: state.submissionDeadline,
          evaluationDeadline: state.evaluationDeadline,
          lastChangedBy: state.lastChangedByUserId
            ? {
                userId: state.lastChangedByUserId,
                name: state.lastChangedByName,
                email: state.lastChangedByEmail,
              }
            : null,
          lastChangedAt: state.lastChangedAt,
        }),
      );
    },
  );
}
