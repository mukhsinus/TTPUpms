export function normalizeStudentId(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}
