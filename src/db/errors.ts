/**
 * Returns the violated constraint name for a PostgreSQL unique violation (23505), or null.
 * Drizzle wraps driver errors, so the cause chain is searched.
 */
export function uniqueViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && typeof candidate.constraint === "string") {
      return candidate.constraint;
    }
    current = candidate.cause;
  }
  return null;
}
