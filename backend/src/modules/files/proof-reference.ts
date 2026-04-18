import { env } from "../../config/env";

const LEGACY_BUCKETS = new Set(["chat-attachments", "proofs", "submission-files"]);

/** Dangerous: Telegram-hosted file URLs must never be accepted as proof. */
export function isUnsafeTelegramProofUrl(value: string): boolean {
  return /api\.telegram\.org\/file\/bot/i.test(value);
}

function extractStoragePathFromSupabasePublicUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const prefix = "/storage/v1/object/public/";
    const idx = u.pathname.indexOf(prefix);
    if (idx === -1) {
      return null;
    }
    const afterPrefix = u.pathname.slice(idx + prefix.length);
    const segments = afterPrefix.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    const bucket = decodeURIComponent(segments[0] ?? "");
    if (!LEGACY_BUCKETS.has(bucket)) {
      return null;
    }
    return segments
      .slice(1)
      .map((s) => decodeURIComponent(s.replace(/\+/g, "%20")))
      .join("/");
  } catch {
    return null;
  }
}

export function isSafeSupabaseProofUrl(url: string): boolean {
  if (!url.startsWith(env.SUPABASE_PROJECT_URL) || !url.includes("/storage/v1/object/")) {
    return false;
  }
  const p = extractStoragePathFromSupabasePublicUrl(url);
  return p !== null;
}

const PATH_WITH_SLASH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+/i;

/**
 * Validates proof reference before persistence: allowed Supabase public URL (legacy buckets) or
 * storage path under our bucket (`userId/uuid-name.ext` or legacy filename only).
 */
export function assertValidProofReference(raw: string): void {
  const t = raw.trim();
  if (!t) {
    throw new Error("Proof reference is empty");
  }
  if (isUnsafeTelegramProofUrl(t)) {
    throw new Error("Unsafe proof URL is not allowed");
  }
  if (/^https?:\/\//i.test(t)) {
    if (!isSafeSupabaseProofUrl(t)) {
      throw new Error("Proof URL must be a Supabase storage public URL for this project");
    }
    return;
  }
  if (PATH_WITH_SLASH.test(t)) {
    return;
  }
  if (!t.includes("/") && /^[a-zA-Z0-9._-]{1,240}$/.test(t)) {
    return;
  }
  throw new Error("Proof must be a storage path (userId/uuid-filename) or a legacy filename");
}

/**
 * Persists only the object path inside the bucket, e.g. `user-uuid/uuid-file.png`.
 * Strips domain/bucket from full Supabase URLs; prepends `ownerUserId/` for legacy bare filenames.
 */
export function normalizeProofReferenceForDb(raw: string, ownerUserId: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) {
    const extracted = extractStoragePathFromSupabasePublicUrl(t);
    if (!extracted) {
      throw new Error("Could not extract storage path from proof URL");
    }
    return extracted;
  }
  if (!t.includes("/")) {
    return `${ownerUserId}/${t}`;
  }
  return t;
}

/** For reads: DB may store legacy bare filename — prefix submission owner id. */
export function normalizeLegacyStoragePathForRead(raw: string, ownerUserId: string): string {
  const t = raw.trim();
  if (!t.includes("/")) {
    return `${ownerUserId}/${t}`;
  }
  return t;
}

/** Object path used to live under bucket `proofs`; new uploads use `STORAGE_BUCKET` (e.g. chat-attachments). */
export function storageBucketForObjectPath(path: string): string {
  if (path.includes("/proofs/")) {
    return "proofs";
  }
  return env.STORAGE_BUCKET;
}
