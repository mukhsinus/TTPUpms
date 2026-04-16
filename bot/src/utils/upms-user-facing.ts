import { UpmsApiError } from "../services/upms-api-error";

export function userFacingUpmsMessage(error: unknown, fallback: string): string {
  if (error instanceof UpmsApiError) {
    switch (error.code) {
      case "SUBMISSION_LIMIT_EXCEEDED":
        return "You already have 3 active submissions (draft, submitted, or under review). Finish or withdraw one in UPMS before starting another from Telegram.";
      case "UNAUTHORIZED":
        return "UPMS rejected this request (bot API key). If you manage the server, ensure BOT_API_KEY matches between the bot and backend.";
      case "VALIDATION_ERROR":
        return error.message;
      case "PROFILE_INCOMPLETE":
        return "Complete your student profile (full name, degree, faculty, student ID) before using submissions.";
      case "SCHEMA_NOT_READY":
        return "System is updating. Please try again in a moment.";
      case "DUPLICATE_STUDENT_ID":
        return "Student ID already exists.";
      case "DUPLICATE_ITEM":
        return "That student ID is already registered. Please verify your ID or contact support.";
      case "CONFLICT":
        return error.message;
      case "TELEGRAM_NOT_LINKED":
        return "Your Telegram account is not linked to a university profile in UPMS.";
      case "EMPTY_RESPONSE":
      case "INVALID_JSON":
      case "INVALID_ENVELOPE":
        return "UPMS returned an unreadable response. Please try again in a moment.";
      case "IDEMPOTENCY_IN_PROGRESS":
      case "IDEMPOTENCY_KEY_CONFLICT":
        return "Please wait a moment and try again.";
      default:
        return error.message || fallback;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
