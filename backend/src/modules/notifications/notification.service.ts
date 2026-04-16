import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";

type SubmissionNotificationStatus = "submitted" | "approved" | "rejected" | "needs_revision";

interface TelegramUserRow {
  telegram_id: string | null;
}

export class NotificationService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly app: FastifyInstance) {}

  notifySubmissionSubmitted(input: { userId: string; submissionId: string; title?: string }): void {
    const titlePart = input.title ? `\nTitle: ${input.title}` : "";
    const text = `Your submission has been submitted successfully.${titlePart}`;
    this.notifyUser(input.userId, text);
  }

  notifySubmissionStatusChanged(input: {
    userId: string;
    submissionId: string;
    status: SubmissionNotificationStatus;
  }): void {
    const readableStatus =
      input.status === "needs_revision" ? "Needs Revision" : input.status[0].toUpperCase() + input.status.slice(1);
    const text = `Submission status updated: ${readableStatus}`;
    this.notifyUser(input.userId, text);
  }

  private notifyUser(userId: string, text: string): void {
    this.enqueue(async () => {
      const chatId = await this.getTelegramChatIdByUserId(userId);
      if (!chatId) {
        return;
      }

      await this.sendTelegramMessage(chatId, text);
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue
      .then(task)
      .catch((error) => {
        this.app.log.error({ err: error }, "Telegram notification task failed");
      });
  }

  private async getTelegramChatIdByUserId(userId: string): Promise<string | null> {
    const result = await this.app.db.query<TelegramUserRow>(
      `
      SELECT telegram_id
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId],
    );

    const chatId = result.rows[0]?.telegram_id;
    return chatId ?? null;
  }

  private async sendTelegramMessage(chatId: string, text: string): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${body}`);
    }
  }
}
