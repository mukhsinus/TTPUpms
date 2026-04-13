import { env } from "../config/env";
import type { CategoryCatalogEntry } from "../types/session";

interface BotApiUserRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  telegramUsername: string | null;
  fullName: string | null;
}

interface BotApiSubmissionRow {
  id: string;
  title: string;
  status: string;
  totalPoints: string;
  createdAt: string;
}

interface UploadProofResponse {
  proofFileUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AuthenticatedTelegramUser {
  id: string;
  role: "student" | "reviewer" | "admin";
  telegramUsername: string | null;
  fullName: string | null;
}

interface ApiEnvelope<T> {
  data: T | null;
  error: {
    message: string;
    code: string;
  } | null;
}

export class UpmsService {
  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${env.BACKEND_API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-bot-api-key": env.BOT_API_KEY,
        ...(init?.headers ?? {}),
      },
    });

    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || payload.error || payload.data === null) {
      throw new Error(payload.error?.message ?? `Backend bot API call failed (${response.status})`);
    }

    return payload.data;
  }

  /** Lookup only — does not create a user. */
  async lookupUserByTelegramId(input: {
    telegramId: string;
    telegramUsername?: string | null;
    fullName?: string | null;
  }): Promise<AuthenticatedTelegramUser | null> {
    const payload = await fetch(`${env.BACKEND_API_URL}/api/bot/users/lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-api-key": env.BOT_API_KEY,
      },
      body: JSON.stringify({
        telegram_id: input.telegramId,
        telegram_username: input.telegramUsername ?? null,
        full_name: input.fullName ?? null,
      }),
    });

    const body = (await payload.json()) as ApiEnvelope<{ user: BotApiUserRow | null }>;
    if (!payload.ok || body.error) {
      throw new Error(body.error?.message ?? `Lookup failed (${payload.status})`);
    }
    if (!body.data?.user) {
      return null;
    }

    const user = body.data.user;
    return {
      id: user.id,
      role: user.role,
      telegramUsername: user.telegramUsername,
      fullName: user.fullName,
    };
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

    return {
      id: user.id,
      role: user.role,
      telegramUsername: user.telegramUsername,
      fullName: user.fullName,
    };
  }

  async linkTelegramByEmail(input: {
    email: string;
    telegramId: string;
    telegramUsername?: string | null;
    fullName?: string | null;
  }): Promise<AuthenticatedTelegramUser | null> {
    const response = await fetch(`${env.BACKEND_API_URL}/api/bot/users/link-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-api-key": env.BOT_API_KEY,
      },
      body: JSON.stringify({
        email: input.email,
        telegram_id: input.telegramId,
        telegram_username: input.telegramUsername ?? null,
        full_name: input.fullName ?? null,
      }),
    });

    const payload = (await response.json()) as ApiEnvelope<BotApiUserRow | null>;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `Link failed (${response.status})`);
    }

    const user = payload.data;
    return user
      ? {
          id: user.id,
          role: user.role,
          telegramUsername: user.telegramUsername,
          fullName: user.fullName,
        }
      : null;
  }

  async getCategoriesCatalog(): Promise<CategoryCatalogEntry[]> {
    const response = await fetch(`${env.BACKEND_API_URL}/api/bot/categories`, {
      method: "GET",
      headers: {
        "x-bot-api-key": env.BOT_API_KEY,
      },
    });

    const payload = (await response.json()) as ApiEnvelope<CategoryCatalogEntry[]>;
    if (!response.ok || payload.error || payload.data === null) {
      throw new Error(payload.error?.message ?? `Categories failed (${response.status})`);
    }

    return payload.data;
  }

  async createDraftSubmission(telegramId: string): Promise<{ submissionId: string }> {
    return this.requestJson<{ submissionId: string }>("/api/bot/submissions/draft", {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId }),
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
  }): Promise<{ itemId: string }> {
    return this.requestJson<{ itemId: string }>("/api/bot/submissions/items", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: input.telegramId,
        submission_id: input.submissionId,
        category_id: input.categoryId,
        subcategory: input.subcategory,
        title: input.title,
        description: input.description,
        proof_file_url: input.proofFileUrl,
        external_link: input.externalLink ?? null,
      }),
    });
  }

  async submitDraft(telegramId: string, submissionId: string): Promise<void> {
    await this.requestJson<{ ok: boolean }>(`/api/bot/submissions/${submissionId}/submit`, {
      method: "POST",
      body: JSON.stringify({ telegram_id: telegramId }),
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
