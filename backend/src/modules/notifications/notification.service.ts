import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";

type SubmissionNotificationStatus = "submitted" | "approved" | "rejected" | "needs_revision";

export interface SubmissionModerationNotificationInput {
  userId: string;
  submissionId: string;
  status: "approved" | "rejected";
  totalScore?: number;
  rejectReason?: string;
}

export interface SubmissionItemsReviewedSummaryInput {
  userId: string;
  submissionId: string;
  submissionTitle: string | null;
  finalStatus: "approved" | "rejected" | "needs_revision";
  overallScore: number;
  items: Array<{
    title: string;
    status: "approved" | "rejected";
    approvedScore: number | null;
    comment: string | null;
  }>;
}

interface TelegramUserRow {
  telegram_id: string | null;
}

interface SuperadminTelegramRow {
  telegram_id: string | null;
}

interface StudentTelegramRow {
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

  /** Instant Telegram message for admin approve/reject from the moderation panel. */
  notifySubmissionModerationResult(input: SubmissionModerationNotificationInput): void {
    let text: string;
    if (input.status === "approved") {
      const score =
        input.totalScore !== undefined && Number.isFinite(input.totalScore)
          ? input.totalScore.toFixed(2)
          : "—";
      text = `Your submission was approved.\nScore awarded: ${score}`;
    } else {
      text = `Your submission was rejected.\nReason: ${input.rejectReason ?? "—"}`;
    }
    this.notifyUser(input.userId, text);
  }

  notifySubmissionItemsReviewedSummary(input: SubmissionItemsReviewedSummaryInput): void {
    const finalStatusLabel =
      input.finalStatus === "approved"
        ? "Approved"
        : input.finalStatus === "rejected"
          ? "Rejected"
          : "Needs revision";
    const header = input.submissionTitle?.trim()
      ? `Your submission "${input.submissionTitle.trim()}" has been fully reviewed.`
      : "Your submission has been fully reviewed.";
    const lines = input.items.map((item, index) => {
      const scorePart =
        item.status === "approved" && item.approvedScore !== null && Number.isFinite(item.approvedScore)
          ? ` | Score: ${item.approvedScore.toFixed(2)}`
          : "";
      const comment = item.comment?.trim() || "—";
      const statusLabel = item.status === "approved" ? "Approved" : "Rejected";
      return `${index + 1}. ${item.title} — ${statusLabel}${scorePart}\nComment: ${comment}`;
    });
    const overall = Number.isFinite(input.overallScore) ? input.overallScore.toFixed(2) : "0.00";
    const text = [header, `Final status: ${finalStatusLabel}`, "", ...lines, "", `Overall score: ${overall}`].join(
      "\n",
    );
    this.notifyUser(input.userId, text);
  }

  /** Sends a security alert to all superadmins that have Telegram linked. */
  notifySuperadminsSecurityAlert(text: string): void {
    this.enqueue(async () => {
      const chatIds = await this.getSuperadminChatIds();
      if (chatIds.length === 0) {
        return;
      }
      await Promise.all(
        chatIds.map(async (chatId) => {
          await this.sendTelegramMessage(chatId, text);
        }),
      );
    });
  }

  notifyStudentsProjectPhaseChanged(input: {
    phase: "submission" | "evaluation";
    submissionDeadline?: string | null;
    evaluationDeadline?: string | null;
  }): void {
    const text =
      input.phase === "submission"
        ? [
            "🟢 Submission phase is now OPEN.",
            "",
            "You can now submit your applications through the bot.",
            input.submissionDeadline ? `Deadline: ${new Date(input.submissionDeadline).toLocaleString("en-GB")}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "🟠 Submission phase has ended.",
            "Evaluation phase has started.",
            "",
            "New submissions are now closed.",
            "Thank you.",
          ].join("\n");

    this.enqueue(async () => {
      const chatIds = await this.getStudentChatIds();
      if (chatIds.length === 0) {
        return;
      }
      const batchSize = 20;
      for (let i = 0; i < chatIds.length; i += batchSize) {
        const chunk = chatIds.slice(i, i + batchSize);
        await Promise.all(
          chunk.map(async (chatId) => {
            await this.sendTelegramMessage(chatId, text);
          }),
        );
        if (i + batchSize < chatIds.length) {
          await new Promise((resolve) => {
            setTimeout(resolve, 1200);
          });
        }
      }
    });
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

  private async getSuperadminChatIds(): Promise<string[]> {
    const result = await this.app.db.query<SuperadminTelegramRow>(
      `
      SELECT DISTINCT u.telegram_id
      FROM public.admin_users au
      INNER JOIN public.users u ON u.id = au.id
      WHERE au.role::text = 'superadmin'
        AND u.telegram_id IS NOT NULL
        AND BTRIM(u.telegram_id) <> ''
      `,
    );
    return result.rows.map((row) => row.telegram_id).filter((value): value is string => Boolean(value));
  }

  private async getStudentChatIds(): Promise<string[]> {
    const result = await this.app.db.query<StudentTelegramRow>(
      `
      SELECT DISTINCT telegram_id
      FROM public.users
      WHERE role::text = 'student'
        AND telegram_id IS NOT NULL
        AND BTRIM(telegram_id) <> ''
      `,
    );
    return result.rows.map((row) => row.telegram_id).filter((value): value is string => Boolean(value));
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
