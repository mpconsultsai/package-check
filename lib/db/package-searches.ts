import type { PackageEcosystem } from "@/lib/package-routes";
import type { Database } from "@/lib/db/client";
import { databaseLogContext, getDb } from "@/lib/db/client";
import { packageSearches, type PackageSearchSource } from "@/lib/db/schema";

const QUERY_MAX = 200;
const RESULT_MAX = 20;

export type { PackageSearchSource };

export type PackageSearchEvent = {
  ecosystem: PackageEcosystem;
  query: string;
  resultNames: string[];
  source: PackageSearchSource;
  metadata?: Record<string, string | number | boolean | null>;
};

/** Insert one anonymous search. A database failure does not throw. */
export async function recordPackageSearch(
  event: PackageSearchEvent,
  db: Database | null = getDb(),
): Promise<void> {
  const query = event.query.trim().slice(0, QUERY_MAX);
  if (query.length < 2) return;
  if (!db) {
    console.error("Package search not recorded: database client unavailable", databaseLogContext());
    return;
  }
  const resultNames = event.resultNames
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, RESULT_MAX);
  try {
    await db.insert(packageSearches).values({
      ecosystem: event.ecosystem,
      query,
      resultCount: resultNames.length,
      resultNames,
      source: event.source,
      metadata: event.metadata ?? {},
    });
  } catch (error: unknown) {
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
    const message = cause instanceof Error ? cause.message : "insert failed";
    const code =
      cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : "";
    if (code === "28P01" || /password/i.test(message)) return;
    console.error("Failed to record package search:", {
      message,
      code,
      ...databaseLogContext(),
    });
  }
}
