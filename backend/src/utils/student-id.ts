/**
 * Normalizes student identifiers into a canonical lookup form.
 *
 * Examples:
 * - "12345" -> "12345"
 * - "SE 12345" -> "SE12345"
 * - "se12345" -> "SE12345"
 */
export function normalizeStudentId(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * True for values that look like student IDs (numeric-only or prefix+number).
 */
export function isLikelyStudentId(value: string): boolean {
  const normalized = normalizeStudentId(value);
  if (!normalized) {
    return false;
  }
  if (/^\d+$/.test(normalized)) {
    return true;
  }
  return /^[A-Z]{1,8}\d+$/.test(normalized);
}
