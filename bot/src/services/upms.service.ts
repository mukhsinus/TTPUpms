import { env } from "../config/env";

interface BotApiUserRow {
  id: string;
  role: "student" | "reviewer" | "admin";
  email: string;
  full_name: string | null;
}

interface BotApiSubmissionRow {
  id: string;
  title: string;
  status: string;
  total_points: string;
  created_at: string;
}

export interface AuthenticatedTelegramUser {
  id: string;
  role: "student" | "reviewer" | "admin";
  email: string;
  fullName: string | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
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
    if (!response.ok || !payload.success) {
      throw new Error(payload.message ?? `Backend bot API call failed (${response.status})`);
    }

    return payload.data;
  }

  async findUserByTelegramId(telegramUserId: number): Promise<AuthenticatedTelegramUser | null> {
    const user = await this.request<BotApiUserRow | null>(`/api/bot/users/telegram/${telegramUserId}`);
    return user
      ? {
          id: user.id,
          role: user.role,
          email: user.email,
          fullName: user.full_name,
        }
      : null;
  }

  async linkTelegramByEmail(email: string, telegramUserId: number): Promise<AuthenticatedTelegramUser | null> {
    const user = await this.request<BotApiUserRow | null>("/api/bot/users/link-email", {
      method: "POST",
      body: JSON.stringify({
        email,
        telegramUserId,
      }),
    });

    return user
      ? {
          id: user.id,
          role: user.role,
          email: user.email,
          fullName: user.full_name,
        }
      : null;
  }

  async createAchievementSubmission(input: {
    userId: string;
    category: string;
    details: string;
    proofFileUrl: string;
  }): Promise<{ submissionId: string }> {
    return this.request<{ submissionId: string }>("/api/bot/submissions/achievement", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getUserSubmissions(userId: string): Promise<BotApiSubmissionRow[]> {
    return this.request<BotApiSubmissionRow[]>(`/api/bot/users/${userId}/submissions`);
  }

  async getUserPoints(userId: string): Promise<number> {
    const result = await this.request<{ totalPoints: number }>(`/api/bot/users/${userId}/points`);
    return result.totalPoints;
  }
}
