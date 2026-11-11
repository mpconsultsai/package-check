import { sql } from "drizzle-orm";
import {
  PACKAGE_ECOSYSTEMS,
  type PackageEcosystem,
} from "@/lib/packages/package-routes";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { asExecuteRows } from "@/lib/db/execute-rows";
import { dbFailureMessage } from "@/lib/db/query-error";

const ACTIVITY_DAYS = 7;
const LIST_LIMIT = 5;
const NAME_MAX = 100;
/** npm/PyPI/NuGet names, plus Maven groupId:artifactId. */
const PACKAGE_NAME =
  /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?::[a-z0-9][\w.-]*)?$/i;

export type ActivePackage = { name: string; checks: number };

export type EcosystemActivity = {
  popular: ActivePackage[];
  recent: ActivePackage[];
};

export type PackageActivity = Record<PackageEcosystem, EcosystemActivity>;

export type PackageActivityRow = {
  ecosystem: unknown;
  name: unknown;
  checks: unknown;
  last_checked: unknown;
};

export const createEmptyPackageActivity = (): PackageActivity => {
  const activity = {} as PackageActivity;
  for (const ecosystem of PACKAGE_ECOSYSTEMS) {
    activity[ecosystem] = { popular: [], recent: [] };
  }
  return activity;
};

const isEcosystem = (value: unknown): value is PackageEcosystem =>
  typeof value === "string" &&
  (PACKAGE_ECOSYSTEMS as readonly string[]).includes(value);

const timestamp = (value: unknown): number => {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
};

/** Most checked and most recently checked packages per registry. */
export const groupPackageActivity = (
  rows: PackageActivityRow[],
): PackageActivity => {
  const byEcosystem = new Map<
    PackageEcosystem,
    { name: string; checks: number; last: number }[]
  >();
  for (const row of rows) {
    if (!isEcosystem(row.ecosystem) || typeof row.name !== "string") continue;
    const name = row.name.trim();
    if (name.length < 2 || name.length > NAME_MAX || !PACKAGE_NAME.test(name)) {
      continue;
    }
    const checks = Number(row.checks);
    if (!Number.isFinite(checks) || checks < 1) continue;
    const list = byEcosystem.get(row.ecosystem) ?? [];
    list.push({ name, checks, last: timestamp(row.last_checked) });
    byEcosystem.set(row.ecosystem, list);
  }

  const activity = createEmptyPackageActivity();
  for (const [ecosystem, list] of byEcosystem) {
    const strip = ({ name, checks }: { name: string; checks: number }) => ({
      name,
      checks,
    });
    activity[ecosystem] = {
      popular: [...list]
        .sort((a, b) => b.checks - a.checks || b.last - a.last || a.name.localeCompare(b.name))
        .slice(0, LIST_LIMIT)
        .map(strip),
      recent: [...list]
        .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
        .slice(0, LIST_LIMIT)
        .map(strip),
    };
  }
  return activity;
};

export type PackageActivityLoad = {
  activity: PackageActivity;
  matchedRows: number;
  error: string | null;
};

/**
 * Packages opened / looked up in the last week.
 * Counts: resolved page opens, MCP package tools, and exact-name web searches
 * that returned the package (so lists still populate when page opens were missed).
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
