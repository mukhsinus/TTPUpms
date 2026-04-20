/** Extract Postgres driver fields when `error` is a node-pg / Postgres error object. */
export function getPostgresDriverErrorFields(error: unknown): {
  code: string;
  message?: string;
  constraint?: string;
} | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const e = error as { code: unknown; message?: unknown; constraint?: unknown };
  if (typeof e.code !== "string") {
    return null;
  }
  return {
    code: e.code,
    message: typeof e.message === "string" ? e.message : undefined,
    constraint: typeof e.constraint === "string" ? e.constraint : undefined,
  };
}

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
    if (msg.includes("CATEGORY_MAX_POINTS_EXCEEDED")) {
      return {
        status: 400,
        code: "CATEGORY_MAX_POINTS_EXCEEDED",
        message: "Approved score exceeds category max points for this submission.",
      };
    }
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
