import { ServiceError } from "../../utils/service-error";

const DIRECT_FILE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "zip",
  "rar",
  "7z",
  "mp3",
  "mp4",
]);

function isDirectFilePath(pathname: string): boolean {
  const normalized = pathname.trim().toLowerCase();
  if (!normalized || normalized.endsWith("/")) {
    return false;
  }
  const lastSegment = normalized.split("/").pop() ?? "";
  if (!lastSegment || !lastSegment.includes(".")) {
    return false;
  }
  const extension = lastSegment.split(".").pop() ?? "";
  return DIRECT_FILE_EXTENSIONS.has(extension);
}

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
  if (isDirectFilePath(u.pathname)) {
    throw new ServiceError(
      400,
      "Only website links are accepted. Direct file links are not allowed.",
      "VALIDATION_ERROR",
    );
  }
  return t;
}
