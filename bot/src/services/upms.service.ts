import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import type { CategoryCatalogEntry } from "../types/session";
import { normalizeStudentId } from "../utils/student-id";
import { UpmsApiError } from "./upms-api-error";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface BotApiUserRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  telegramUsername: string | null;
  fullName: string | null;
  studentFullName: string | null;
  faculty: string | null;
  studentId: string | null;
  degree: "bachelor" | "master" | null;
  isProfileCompleted: boolean;
}

interface BotApiSubmissionRow {
  id: string;
  title: string;
  items: SubmitDraftSuccessItem[];
  status: string;
  totalPoints: string;
  createdAt: string;
}

interface UploadProofResponse {
  proofFileUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export interface BotSystemPhaseState {
  phase: "submission" | "evaluation";
  submissionDeadline: string | null;
  evaluationDeadline: string | null;
}

/** Mirrors backend `BotSubmitDraftResult` (camelCase in JSON). */
export interface SubmitDraftSuccessItem {
  title: string;
  category: string;
  categoryTitle: string;
  subcategory: string;
  description: string;
  link: string | null;
  hasFile: boolean;
  status: "pending" | "approved" | "rejected";
  approvedScore: number | null;
}

export interface SubmitDraftSuccess {
  submissionId: string;
  items: SubmitDraftSuccessItem[];
}

export interface AuthenticatedTelegramUser {
  id: string;
  role: "student" | "reviewer" | "admin";
  telegramUsername: string | null;
  fullName: string | null;
  studentFullName: string | null;
  faculty: string | null;
  studentId: string | null;
  degree: "bachelor" | "master" | null;
  isProfileCompleted: boolean;
}

function mapBotUserRow(user: BotApiUserRow): AuthenticatedTelegramUser {
  return {
    id: user.id,
    role: user.role,
    telegramUsername: user.telegramUsername,
    fullName: user.fullName,
    studentFullName: user.studentFullName ?? null,
    faculty: user.faculty ?? null,
    studentId: user.studentId ?? null,
    degree: user.degree ?? null,
    isProfileCompleted: Boolean(user.isProfileCompleted),
  };
}

/** Display layer: never show snake_case from code/name/slug in UI. */
function stripUnderscoresDisplay(s: string): string {
  return s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function universalWhatCounts(): string {
  return (
    "• Describe only real activities you can prove with documents.\n" +
    "• Your proof should match the title and description you enter next."
  );
}

function universalScoring(category: Pick<CategoryCatalogEntry, "minScore" | "maxScore">): string {
  const min = category.minScore;
  const max = category.maxScore;
  if (Number.isFinite(min) && Number.isFinite(max)) {
    return (
      "• Reviewers apply the official UPMS rubric.\n" +
      `• Typical points band for this category: ${min}–${max} (subject to caps and final review).`
    );
  }
  return "• Reviewers apply the official UPMS rubric; final points are assigned after review.";
}

type ApiCategoryCatalogRow = Omit<CategoryCatalogEntry, "whatCounts" | "scoring"> & {
  hasSubcategories?: boolean;
  whatCounts?: string;
  scoring?: string;
};

function normalizeCategoryCatalogEntry(c: ApiCategoryCatalogRow): CategoryCatalogEntry {
  const titleSource = (c.title ?? c.name ?? c.code ?? "").toString();
  const title = stripUnderscoresDisplay(titleSource);
  const subcategories = (c.subcategories ?? []).map((s) => {
    const subTitleSource = (s.title ?? s.label ?? s.slug ?? "").toString();
    return {
      ...s,
      title: stripUnderscoresDisplay(subTitleSource),
    };
  });
  const hasSubcategories = c.hasSubcategories ?? subcategories.length > 0;
  const whatCountsRaw = c.whatCounts?.trim();
  const scoringRaw = c.scoring?.trim();
  return {
    id: c.id,
    code: c.code,
    title,
    name: c.name,
    description: c.description,
    type: c.type,
    minScore: c.minScore,
    maxScore: c.maxScore,
    hasSubcategories,
    whatCounts: whatCountsRaw ? stripUnderscoresDisplay(whatCountsRaw) : universalWhatCounts(),
    scoring: scoringRaw ? stripUnderscoresDisplay(scoringRaw) : universalScoring(c),
    subcategories,
  };
}

interface ApiEnvelope<T> {
  data: T | null;
  error: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
  } | null;
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return "data" in o && "error" in o;
}

function parseEnvelopeFromText(rawText: string, httpStatus: number, pathForLog: string): ApiEnvelope<unknown> {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new UpmsApiError(`Empty response from UPMS (${httpStatus})`, {
      code: "EMPTY_RESPONSE",
      httpStatus,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new UpmsApiError(`Invalid JSON from UPMS (${httpStatus}) for ${pathForLog}`, {
      code: "INVALID_JSON",
      httpStatus,
    });
  }

  if (!isApiEnvelope(parsed)) {
    throw new UpmsApiError(`Unexpected response shape from UPMS (${httpStatus}) for ${pathForLog}`, {
      code: "INVALID_ENVELOPE",
      httpStatus,
    });
  }

  return parsed;
}

export class UpmsService {
  /**
   * Builds fetch headers: auto `Idempotency-Key` only for mutating methods when missing.
   * GET/HEAD/OPTIONS never auto-add idempotency; caller may still pass `Idempotency-Key` explicitly.
   */
  private buildBotApiHeaders(init?: RequestInit): Headers {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers();

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    headers.set("x-bot-api-key", env.BOT_API_KEY);

    if (READ_METHODS.has(method)) {
      return headers;
    }

    if (MUTATING_METHODS.has(method)) {
      headers.set("Content-Type", "application/json");
      if (!headers.has("Idempotency-Key")) {
        headers.set("Idempotency-Key", randomUUID());
      }
      return headers;
    }

    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return headers;
  }

  private readFailure(envelope: ApiEnvelope<unknown>, httpStatus: number): UpmsApiError {
    const code = envelope.error?.code ?? "REQUEST_FAILED";
    const msg = envelope.error?.message ?? `Backend bot API call failed (${httpStatus})`;
    const details = envelope.error?.details;
    return new UpmsApiError(msg, { code, httpStatus, details });
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = this.buildBotApiHeaders(init);
    const url = `${env.BACKEND_API_URL}${path}`;

    const response = await fetch(url, {
      ...init,
      headers,
    });

    const rawText = await response.text();
    let envelope: ApiEnvelope<T>;
    try {
      envelope = parseEnvelopeFromText(rawText, response.status, path) as ApiEnvelope<T>;
    } catch (err) {
      // Backend sometimes completes status before body is intact (e.g. reply lifecycle bug).
      // Draft 409 without body is almost always active-submission quota from Postgres.
      if (
        err instanceof UpmsApiError &&
        err.code === "EMPTY_RESPONSE" &&
        response.status === 409 &&
        path === "/api/bot/submissions/draft"
      ) {
        throw new UpmsApiError("Maximum of 3 active submissions per user.", {
          code: "SUBMISSION_LIMIT_EXCEEDED",
          httpStatus: 409,
        });
      }
      throw err;
    }

    if (!response.ok || envelope.error || envelope.data === null) {
      throw this.readFailure(envelope as ApiEnvelope<unknown>, response.status);
    }

    return envelope.data;
  }

  /** Lookup only — does not create a user. */
  async lookupUserByTelegramId(input: {
    telegramId: string;
    telegramUsername?: string | null;
    fullName?: string | null;
  }): Promise<AuthenticatedTelegramUser | null> {
    const path = "/api/bot/users/lookup";
    const response = await fetch(`${env.BACKEND_API_URL}${path}`, {
      method: "POST",
      headers: this.buildBotApiHeaders({ method: "POST" }),
      body: JSON.stringify({
        telegram_id: input.telegramId,
        telegram_username: input.telegramUsername ?? null,
        full_name: input.fullName ?? null,
      }),
    });

    const rawText = await response.text();
    const envelope = parseEnvelopeFromText(rawText, response.status, path) as ApiEnvelope<{ user: BotApiUserRow | null }>;

    if (!response.ok || envelope.error) {
      throw this.readFailure(envelope, response.status);
    }

    const user = envelope.data?.user;
    if (!user) {
      return null;
    }

    return mapBotUserRow(user);
  }

  /** Ensures a user row exists (used by list/points/upload). */
  async resolveUserByTelegramId(input: {
    telegramId: string;
    telegramUsername?: string | null;
    fullName?: string | null;
  }): Promise<AuthenticatedTelegramUser> {
    const user = await this.requestJson<BotApiUserRow>("/api/bot/users/resolve", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: input.telegramId,
        telegram_username: input.telegramUsername ?? null,
        full_name: input.fullName ?? null,
      }),
    });

    return mapBotUserRow(user);
  }

  async completeStudentProfile(input: {
    telegramId: string;
    studentFullName: string;
    degree: "bachelor" | "master";
    faculty: string;
    studentId: string;
  }): Promise<AuthenticatedTelegramUser> {
    const data = await this.requestJson<BotApiUserRow>("/api/bot/users/profile/complete", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: input.telegramId,
        student_full_name: input.studentFullName,
        degree: input.degree,
        faculty: input.faculty,
        student_id: normalizeStudentId(input.studentId),
      }),
    });
    return mapBotUserRow(data);
  }

  async getCategoriesCatalog(): Promise<CategoryCatalogEntry[]> {
    const raw = await this.requestJson<ApiCategoryCatalogRow[]>("/api/bot/categories", { method: "GET" });
    return raw.map((c) => normalizeCategoryCatalogEntry(c));
  }

  async createDraftSubmission(telegramId: string, title: string): Promise<{ submissionId: string }> {
    return this.requestJson<{ submissionId: string }>("/api/bot/submissions/draft", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId, title }),
    });
  }

  async addSubmissionItem(input: {
    telegramId: string;
    submissionId: string;
    categoryId: string;
    subcategory: string | null;
    title: string;
    description: string;
    proofFileUrl: string;
    externalLink?: string | null;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{ itemId: string }> {
    const body: Record<string, unknown> = {
      telegram_id: input.telegramId,
      submission_id: input.submissionId,
      category_id: input.categoryId,
      title: input.title,
      description: input.description,
      proof_file_url: input.proofFileUrl,
      external_link: input.externalLink ?? null,
    };
    if (input.subcategory !== null && input.subcategory !== undefined && input.subcategory !== "") {
      body.subcategory = input.subcategory;
    }
    if (input.metadata !== undefined && Object.keys(input.metadata).length > 0) {
      body.metadata = input.metadata;
    }
    return this.requestJson<{ itemId: string }>("/api/bot/submissions/items", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async submitDraft(telegramId: string, submissionId: string): Promise<SubmitDraftSuccess> {
    return this.requestJson<SubmitDraftSuccess>(`/api/bot/submissions/${submissionId}/submit`, {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId }),
    });
  }

  /** Single transaction: create submission, all lines, submit (Telegram bot — no draft/items during FSM). */
  async completeBotSubmission(input: {
    telegramId: string;
    items: Array<{
      categoryId: string;
      subcategorySlug: string | null;
      title: string;
      description: string;
      proofFileUrl: string;
      externalLink: string | null;
      metadata?: Record<string, string | number | boolean>;
    }>;
  }): Promise<SubmitDraftSuccess> {
    return this.requestJson<SubmitDraftSuccess>("/api/bot/submissions/complete", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: input.telegramId,
        items: input.items.map((it) => ({
          category_id: it.categoryId,
          subcategory: it.subcategorySlug,
          title: it.title,
          description: it.description,
          proof_file_url: it.proofFileUrl,
          external_link: it.externalLink,
          metadata: it.metadata,
        })),
      }),
    });
  }

  /** @deprecated Legacy single-shot create; prefer draft + items + submit. */
  async createStudentSubmission(input: {
    telegramId: string;
    categoryId: string;
    subcategory: string;
    title: string;
    description: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    return this.requestJson<{ submissionId: string }>("/api/bot/submissions/student", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: input.telegramId,
        category_id: input.categoryId,
        subcategory: input.subcategory,
        title: input.title,
        description: input.description,
        proof_file_url: input.proofFileUrl,
      }),
    });
  }

  async getUserSubmissions(telegramId: string): Promise<BotApiSubmissionRow[]> {
    await this.resolveUserByTelegramId({ telegramId });
    return this.requestJson<BotApiSubmissionRow[]>("/api/bot/submissions/list", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: String(telegramId),
      }),
    });
  }

  async getUserPoints(telegramId: string): Promise<number> {
    await this.resolveUserByTelegramId({ telegramId });
    const result = await this.requestJson<{ totalPoints: number }>("/api/bot/points", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: String(telegramId),
      }),
    });
    return result.totalPoints;
  }

  async getSystemPhase(): Promise<BotSystemPhaseState> {
    return this.requestJson<BotSystemPhaseState>("/api/system/phase", {
      method: "GET",
    });
  }

  async uploadProofFile(input: {
    telegramId: string;
    filename: string;
    mimeType: "application/pdf" | "image/jpeg" | "image/png";
    bytes: Buffer;
  }): Promise<UploadProofResponse> {
    await this.resolveUserByTelegramId({ telegramId: input.telegramId });
    return this.requestJson<UploadProofResponse>("/api/bot/files/upload", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: input.telegramId,
        filename: input.filename,
        mimeType: input.mimeType,
        fileBase64: input.bytes.toString("base64"),
      }),
    });
  }
}
