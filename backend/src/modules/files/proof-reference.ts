import { env } from "../../config/env";

/** Dangerous: Telegram-hosted file URLs must never be accepted as proof. */
export function isUnsafeTelegramProofUrl(value: string): boolean {
  return /api\.telegram\.org\/file\/bot/i.test(value);
}

const STORAGE_PUBLIC_PREFIX = "/storage/v1/object/public/";
const STORAGE_SIGN_PREFIX = "/storage/v1/object/sign/";

/**
 * Extracts object path (within bucket) from a Supabase Storage URL for this project
 * (`/object/public/...` or `/object/sign/...`). The bucket segment in the URL is ignored;
 * callers resolve reads via `STORAGE_BUCKET`.
 */
export function extractStoragePathFromSupabasePublicUrl(urlStr: string): string | null {
  try {
    const projectOrigin = new URL(env.SUPABASE_PROJECT_URL.replace(/\/$/, "")).origin;
    const u = new URL(urlStr);
    if (u.origin !== projectOrigin) {
      return null;
    }
    let afterPrefix: string | null = null;
    const pub = u.pathname.indexOf(STORAGE_PUBLIC_PREFIX);
    const sig = u.pathname.indexOf(STORAGE_SIGN_PREFIX);
    if (pub !== -1) {
      afterPrefix = u.pathname.slice(pub + STORAGE_PUBLIC_PREFIX.length);
    } else if (sig !== -1) {
      afterPrefix = u.pathname.slice(sig + STORAGE_SIGN_PREFIX.length);
    }
    if (afterPrefix === null) {
      return null;
    }
    const segments = afterPrefix.split("/").filter(Boolean);
    if (segments.length < 2) {
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
  try {
    const projectOrigin = new URL(env.SUPABASE_PROJECT_URL.replace(/\/$/, "")).origin;
    const u = new URL(url);
    if (u.origin !== projectOrigin || !u.pathname.includes("/storage/v1/object/")) {
      return false;
    }
    return extractStoragePathFromSupabasePublicUrl(url) !== null;
  } catch {
    return false;
  }
}

const PATH_WITH_SLASH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/.+/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips legacy `proofs/` folder segments from object keys. Objects are always read from `STORAGE_BUCKET`.
 */
export function normalizeLegacyStorageObjectPath(path: string): string {
  let p = path.trim().replace(/^\/+/, "");
  p = p.replace(/^proofs\/+/i, "");
  p = p.replace(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/proofs\//i,
    "$1/",
  );
  // Legacy object keys sometimes duplicated a mistaken bucket name as a path prefix.
  p = p.replace(/^submission-files\//i, "");
  const activeBucket = env.STORAGE_BUCKET.trim();
  if (activeBucket.length > 0) {
    p = p.replace(new RegExp(`^${escapeRegExp(activeBucket)}\/`, "i"), "");
  }
  return p;
}

/**
 * Validates proof reference before persistence: allowed Supabase public URL for this project or
 * storage path under the active bucket (`userId/uuid-name.ext` or legacy filename only).
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
    return normalizeLegacyStorageObjectPath(extracted);
  }
  if (!t.includes("/")) {
    return `${ownerUserId}/${t}`;
  }
  return normalizeLegacyStorageObjectPath(t);
}

/** For reads: DB may store legacy bare filename — prefix submission owner id. */
export function normalizeLegacyStoragePathForRead(raw: string, ownerUserId: string): string {
  const t = raw.trim();
  if (!t.includes("/")) {
    return `${ownerUserId}/${t}`;
  }
  return t;
}
