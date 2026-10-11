import type { PackageEcosystem } from "@/lib/package-routes";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
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
  if (query.length < 2 || !db) return;
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
    const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
    const message =
      cause instanceof Error
        ? cause.message
        : error instanceof Error
          ? error.message
          : "insert failed";
    console.error("Failed to record package search:", message);
  }
}
