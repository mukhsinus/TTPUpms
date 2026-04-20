import type { FastifyInstance } from "fastify";
import { ServiceError } from "../../utils/service-error";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { SystemPhaseRepository } from "./system-phase.repository";
import type { ProjectPhase, ProjectPhaseState } from "./system-phase.types";

const DEFAULT_PHASE: ProjectPhase = "submission";
const PHASE_CACHE_TTL_MS = 15_000;

interface PhaseCache {
  expiresAt: number;
  value: ProjectPhaseState;
}

function parseDeadline(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export class SystemPhaseService {
  private readonly repository: SystemPhaseRepository;
  private readonly notifications: NotificationService;
  private readonly audit: AuditLogRepository;
  private cache: PhaseCache | null = null;

  constructor(private readonly app: FastifyInstance) {
    this.repository = new SystemPhaseRepository(app);
    this.notifications = new NotificationService(app);
    this.audit = new AuditLogRepository(app);
  }

  private invalidateCache(): void {
    this.cache = null;
  }

  async getPhaseState(options?: { forceRefresh?: boolean }): Promise<ProjectPhaseState> {
    if (!options?.forceRefresh && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }
    const map = await this.repository.getSettings([
      "project_phase",
      "submission_deadline",
      "evaluation_deadline",
      "project_phase_changed_by",
      "project_phase_changed_at",
    ]);
    const phaseRaw = (map.get("project_phase")?.value ?? DEFAULT_PHASE).trim().toLowerCase();
    const phase: ProjectPhase = phaseRaw === "evaluation" ? "evaluation" : "submission";
    const submissionDeadline = parseDeadline(map.get("submission_deadline")?.value ?? null);
    const evaluationDeadline = parseDeadline(map.get("evaluation_deadline")?.value ?? null);
    const lastChangedByRaw = map.get("project_phase_changed_by")?.value ?? null;
    const lastChangedByUserId =
      lastChangedByRaw && lastChangedByRaw !== "system" ? lastChangedByRaw : null;
    const lastChangedAt = parseDeadline(map.get("project_phase_changed_at")?.value ?? null);

    let lastChangedByName: string | null = null;
    let lastChangedByEmail: string | null = null;
    if (lastChangedByUserId) {
      const user = await this.repository.findUserBriefById(lastChangedByUserId);
      lastChangedByName = user?.name ?? null;
      lastChangedByEmail = user?.email ?? null;
    }

    const value: ProjectPhaseState = {
      phase,
      submissionDeadline,
      evaluationDeadline,
      lastChangedByUserId,
      lastChangedAt,
      lastChangedByName,
      lastChangedByEmail,
    };
    this.cache = {
      expiresAt: Date.now() + PHASE_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  async setPhase(input: {
    phase: ProjectPhase;
    actorUserId: string;
    requestIp?: string | null;
    userAgent?: string | null;
  }): Promise<ProjectPhaseState> {
    const prev = await this.getPhaseState({ forceRefresh: true });
    if (prev.phase === input.phase) {
      return prev;
    }
    const changedAtIso = new Date().toISOString();
    await this.repository.setPhaseWithAuditMeta({
      phase: input.phase,
      actorUserId: input.actorUserId,
      changedAtIso,
    });
    this.invalidateCache();
    const next = await this.getPhaseState({ forceRefresh: true });

    await this.audit.insert({
      actorUserId: input.actorUserId,
      entityTable: "system_settings",
      entityId: "project_phase",
      action: "project_phase_changed",
      oldValues: { phase: prev.phase },
      newValues: { phase: next.phase },
      metadata: {
        submissionDeadline: next.submissionDeadline,
        evaluationDeadline: next.evaluationDeadline,
      },
      requestIp: input.requestIp ?? null,
      userAgent: input.userAgent ?? null,
    });

    this.notifications.notifyStudentsProjectPhaseChanged({
      phase: next.phase,
      submissionDeadline: next.submissionDeadline,
      evaluationDeadline: next.evaluationDeadline,
    });

    return next;
  }

  async setDeadlines(input: {
    submissionDeadline: string | null;
    evaluationDeadline: string | null;
    actorUserId: string;
    requestIp?: string | null;
    userAgent?: string | null;
  }): Promise<ProjectPhaseState> {
    const parse = (value: string | null): string | null => {
      if (value === null) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw new ServiceError(400, "Invalid deadline datetime format", "VALIDATION_ERROR");
      }
      return date.toISOString();
    };

    const nextSubmission = parse(input.submissionDeadline);
    const nextEvaluation = parse(input.evaluationDeadline);
    if (nextSubmission && nextEvaluation && new Date(nextEvaluation).getTime() < new Date(nextSubmission).getTime()) {
      throw new ServiceError(
        400,
        "Evaluation deadline cannot be earlier than submission deadline",
        "VALIDATION_ERROR",
      );
    }

    const prev = await this.getPhaseState({ forceRefresh: true });
    await this.repository.setDeadlines({
      submissionDeadline: nextSubmission,
      evaluationDeadline: nextEvaluation,
    });
    this.invalidateCache();
    const next = await this.getPhaseState({ forceRefresh: true });

    await this.audit.insert({
      actorUserId: input.actorUserId,
      entityTable: "system_settings",
      entityId: "project_deadlines",
      action: "project_deadlines_changed",
      oldValues: {
        submissionDeadline: prev.submissionDeadline,
        evaluationDeadline: prev.evaluationDeadline,
      },
      newValues: {
        submissionDeadline: next.submissionDeadline,
        evaluationDeadline: next.evaluationDeadline,
      },
      requestIp: input.requestIp ?? null,
      userAgent: input.userAgent ?? null,
    });

    return next;
  }

  async enforceSubmissionOpenForStudent(): Promise<void> {
    const state = await this.getPhaseState();
    if (state.phase === "evaluation") {
      const err = new Error("Submission phase has ended. Evaluation is in progress.");
      (err as Error & { statusCode?: number; code?: string }).statusCode = 403;
      (err as Error & { statusCode?: number; code?: string }).code = "SUBMISSION_CLOSED";
      throw err;
    }
  }

  async applyAutomaticTransitions(): Promise<void> {
    const state = await this.getPhaseState({ forceRefresh: true });
    if (state.phase !== "submission") {
      return;
    }
    if (!state.submissionDeadline) {
      return;
    }
    const deadlineTs = new Date(state.submissionDeadline).getTime();
    if (!Number.isFinite(deadlineTs) || Date.now() < deadlineTs) {
      return;
    }

    const changedAtIso = new Date().toISOString();
    await this.repository.setPhaseWithAuditMeta({
      phase: "evaluation",
      actorUserId: null,
      changedAtIso,
    });
    this.invalidateCache();
    const next = await this.getPhaseState({ forceRefresh: true });
    this.notifications.notifyStudentsProjectPhaseChanged({
      phase: next.phase,
      submissionDeadline: next.submissionDeadline,
      evaluationDeadline: next.evaluationDeadline,
    });
  }

  async shouldAllowBotStudentSubmission(telegramId: string): Promise<boolean> {
    const state = await this.getPhaseState();
    if (state.phase !== "evaluation") {
      return true;
    }
    const user = await this.repository.findTelegramUserById(telegramId);
    if (!user) {
      return false;
    }
    return user.role !== "student";
  }
}
