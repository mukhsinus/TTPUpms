import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { NotificationService } from "../notifications/notification.service";
import { AntiFraudService } from "../validation/anti-fraud.service";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsRepository } from "./submissions.repository";
import { SubmissionsService } from "./submissions.service";

export async function submissionsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new SubmissionsRepository(app);
  const notifications = new NotificationService(app);
  const antiFraud = new AntiFraudService(app);
  const service = new SubmissionsService(repository, notifications, antiFraud);
  const controller = new SubmissionsController(service);

  app.post("/", { preHandler: authMiddleware }, controller.createSubmission);
  app.get("/", { preHandler: authMiddleware }, controller.getUserSubmissions);
  app.get("/:id", { preHandler: authMiddleware }, controller.getSubmissionById);
  app.post("/:id/submit", { preHandler: authMiddleware }, controller.submitSubmission);
}
