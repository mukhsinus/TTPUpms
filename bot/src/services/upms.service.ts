import { env } from "../config/env";

interface BotApiUserRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  email: string;
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
  email: string;
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
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
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

  async findUserByTelegramId(telegramId: string): Promise<AuthenticatedTelegramUser | null> {
    const user = await this.request<BotApiUserRow | null>("/api/bot/users/resolve", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: telegramId,
      }),
    });
    return user
      ? {
          id: user.id,
          role: user.role,
          email: user.email,
          fullName: user.fullName,
        }
      : null;
  }

  async linkTelegramByEmail(email: string, telegramId: string): Promise<AuthenticatedTelegramUser | null> {
    const user = await this.request<BotApiUserRow | null>("/api/bot/users/link-email", {
      method: "POST",
      body: JSON.stringify({
        email,
        telegram_id: telegramId,
      }),
    });

    return user
      ? {
          id: user.id,
          role: user.role,
          email: user.email,
          fullName: user.fullName,
        }
      : null;
  }

  async createAchievementSubmission(input: {
    telegramId: string;
    category: string;
    details: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    return this.request<{ submissionId: string }>("/api/bot/submissions/achievement", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: input.telegramId,
        category: input.category,
        details: input.details,
        proofFileUrl: input.proofFileUrl,
      }),
    });
  }

  async getUserSubmissions(telegramId: string): Promise<BotApiSubmissionRow[]> {
    return this.request<BotApiSubmissionRow[]>("/api/bot/submissions/list", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: String(telegramId),
      }),
    });
  }

  async getUserPoints(telegramId: string): Promise<number> {
    const result = await this.request<{ totalPoints: number }>("/api/bot/points", {
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
    return this.request<UploadProofResponse>("/api/bot/files/upload", {
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
