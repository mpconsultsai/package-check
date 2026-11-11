/** Unwrap drizzle/postgres errors to a short message for logs and API payloads. */
export const dbFailureMessage = (
  error: unknown,
  fallback = "database query failed",
): string => {
  const cause =
    error instanceof Error && error.cause !== undefined ? error.cause : error;
  return cause instanceof Error ? cause.message : fallback;
};
