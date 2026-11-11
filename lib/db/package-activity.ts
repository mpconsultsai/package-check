import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { asExecuteRows } from "@/lib/db/execute-rows";
import { dbFailureMessage } from "@/lib/db/query-error";
import {
  createEmptyPackageActivity,
  groupPackageActivity,
  type PackageActivity,
  type PackageActivityRow,
} from "@/lib/db/package-activity-model";

export {
  createEmptyPackageActivity,
  groupPackageActivity,
  type ActivePackage,
  type EcosystemActivity,
  type PackageActivity,
  type PackageActivityRow,
} from "@/lib/db/package-activity-model";

const ACTIVITY_DAYS = 7;

export type PackageActivityLoad = {
  activity: PackageActivity;
  matchedRows: number;
  error: string | null;
};

/**
 * Packages opened / looked up in the last week.
 * Counts: resolved page opens, MCP package tools, and exact-name web searches
 * that returned the package (so lists still populate when page opens were missed).
 *
 * Server-only — imports the Postgres client. Browser UI must import from
 * `package-activity-model` instead.
 */
export const loadPackageActivity = async (
  db: Database | null = getDb(),
): Promise<PackageActivityLoad> => {
  if (!db) {
    return { activity: createEmptyPackageActivity(), matchedRows: 0, error: null };
  }
  try {
    // Unprepared queries (transaction pooler) cannot bind a Date; send ISO text.
    const day = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - ACTIVITY_DAYS * day).toISOString();
    const result = await db.execute<PackageActivityRow>(sql`
      select
        ecosystem,
        (array_agg(btrim(query) order by created_at desc))[1] as name,
        count(*)::int as checks,
        max(created_at) as last_checked
      from package_searches
      where created_at >= ${since}
        and (
          metadata->>'page' = 'true'
          or metadata->>'tool' in (
            'get_package',
            'get_security',
            'upgrade_package',
            'analyse_package'
          )
          or (
            coalesce(metadata->>'page', '') <> 'true'
            and (
              metadata->>'tool' is null
              or metadata->>'tool' = 'search_packages'
            )
            and exists (
              select 1
              from unnest(result_names) as hit(package_name)
              where lower(btrim(hit.package_name)) = query_normalized
            )
          )
        )
      group by ecosystem, query_normalized
    `);
    const rows = asExecuteRows<PackageActivityRow>(result);
    return {
      activity: groupPackageActivity(rows),
      matchedRows: rows.length,
      error: null,
    };
  } catch (error: unknown) {
    const message = dbFailureMessage(error, "activity query failed");
    console.error("Failed to load package activity:", message);
    return {
      activity: createEmptyPackageActivity(),
      matchedRows: 0,
      error: message,
    };
  }
};
