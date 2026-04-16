import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { idempotencyOnSend, idempotencyPreHandler } from "../../middleware/idempotency.middleware";
import { userWriteRateLimitPreHandler } from "../../middleware/user-write-rate-limit.middleware";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { AntiFraudService } from "../validation/anti-fraud.service";
import { UsersRepository } from "../users/users.repository";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsRepository } from "./submissions.repository";
import { SubmissionsService } from "./submissions.service";

const submissionWriteRate = userWriteRateLimitPreHandler({
  max: 10,
  windowMs: 60_000,
  namespace: "submissions-write",
});

export async function submissionsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new SubmissionsRepository(app);
  const notifications = new NotificationService(app);
  const antiFraud = new AntiFraudService(app);
  const audit = new AuditLogRepository(app);
  const usersRepository = new UsersRepository(app);
  const service = new SubmissionsService(repository, notifications, antiFraud, audit, usersRepository);
  const controller = new SubmissionsController(service);
  const submissionsIdempotency = idempotencyPreHandler(app, "submissions", { requireIdempotencyKey: true });
  const submissionSubmitIdempotency = idempotencyPreHandler(app, "submissions_submit", {
    requireIdempotencyKey: true,
  });
  const onSendIdempotency = idempotencyOnSend(app);

  app.post(
    "/",
    {
      preHandler: [authMiddleware, submissionWriteRate, submissionsIdempotency],
      onSend: [onSendIdempotency],
    },
    controller.createSubmission,
  );
  app.get("/", { preHandler: authMiddleware }, controller.getUserSubmissions);
  app.get("/:id", { preHandler: authMiddleware }, controller.getSubmissionById);
  app.post(
    "/:id/submit",
    {
      preHandler: [authMiddleware, submissionWriteRate, submissionSubmitIdempotency],
      onSend: [onSendIdempotency],
    },
    controller.submitSubmission,
  );
}
