/** Structured HTTP errors for the Telegram bot API (mapped in bot-api.routes). */
export class BotApiHttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(statusCode: number, message: string, errorCode = "BOT_API_ERROR") {
    super(message);
    this.name = "BotApiHttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}
