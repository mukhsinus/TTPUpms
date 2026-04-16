import { ServiceError } from "../../utils/service-error";

/** Persist only http(s) URLs or null; rejects invalid input (never undefined for DB drivers). */
export function normalizeExternalLinkForPersistence(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const t = raw.trim();
  if (!t) {
    return null;
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new ServiceError(400, "Invalid link URL", "VALIDATION_ERROR");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ServiceError(400, "Link must start with http:// or https://", "VALIDATION_ERROR");
  }
  return t;
}
