export function normalizeStudentId(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

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
