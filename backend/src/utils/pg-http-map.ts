/**
 * Maps Postgres driver errors to stable API codes (never expose raw SQLSTATE text to clients).
 */
export function mapPgErrorToClient(error: unknown): {
  status: number;
  code: string;
  message: string;
} | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const e = error as { code: string; message?: string; detail?: string; constraint?: string };

  if (e.code === "23505") {
    return {
      status: 409,
      code: "DUPLICATE_ITEM",
      message: "A conflicting record already exists.",
    };
  }

  if (e.code === "23514") {
    const msg = e.message ?? "";
    if (msg.includes("SUBMISSION_LIMIT_EXCEEDED")) {
      return {
        status: 409,
        code: "SUBMISSION_LIMIT_EXCEEDED",
        message: "Maximum of 3 active submissions per user.",
      };
    }
    return {
      status: 400,
      code: "CHECK_VIOLATION",
      message: "Request violates a data integrity rule.",
    };
  }

  return null;
}
