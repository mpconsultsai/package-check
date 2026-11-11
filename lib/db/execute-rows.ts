/**
 * Normalize drizzle `execute` / postgres.js results to a plain row array.
 * Drivers may return an array or `{ rows }`.
 */
export const asExecuteRows = <T>(result: unknown): T[] => {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
};
