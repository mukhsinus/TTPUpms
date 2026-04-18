import { env } from "../../config/env";

/**
 * Prefer stored `file_url` when it is already absolute; otherwise build the public object URL from
 * `bucket` + `storage_path` (Supabase public bucket layout).
 */
export function resolveStoragePublicFileUrl(
  fileUrl: string | null | undefined,
  bucket: string | null | undefined,
  storagePath: string | null | undefined,
): string | null {
  const u = fileUrl?.trim() ?? "";
  if (u.length > 0 && /^https?:\/\//i.test(u)) {
    return u;
  }
  const path = storagePath?.trim();
  if (!path) {
    return u.length > 0 ? u : null;
  }
  const b = (bucket?.trim() || env.STORAGE_BUCKET).replace(/\/$/, "");
  const base = env.SUPABASE_PROJECT_URL.replace(/\/$/, "");
  const encodedPath = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${base}/storage/v1/object/public/${encodeURIComponent(b)}/${encodedPath}`;
}
