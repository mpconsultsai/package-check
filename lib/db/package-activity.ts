import { sql } from "drizzle-orm";
import {
  PACKAGE_ECOSYSTEMS,
  type PackageEcosystem,
} from "@/lib/package-routes";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";

const ACTIVITY_DAYS = 7;
const VERIFY_DAYS = 30;
const LIST_LIMIT = 8;
const NAME_MAX = 100;
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

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

function emptyActivity(): PackageActivity {
  return Object.fromEntries(
    PACKAGE_ECOSYSTEMS.map((ecosystem) => [ecosystem, { popular: [], recent: [] }]),
  ) as unknown as PackageActivity;
}

function isEcosystem(value: unknown): value is PackageEcosystem {
  return (
    typeof value === "string" &&
    (PACKAGE_ECOSYSTEMS as readonly string[]).includes(value)
  );
}

function timestamp(value: unknown): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
}

/** Most checked and most recently checked packages per registry. */
export function groupPackageActivity(rows: PackageActivityRow[]): PackageActivity {
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

  const activity = emptyActivity();
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
}

/**
 * Packages opened in the last week. A name only counts once a registry search has returned it,
 * so typed URLs for packages that do not exist never reach the home page.
 */
export async function loadPackageActivity(
  db: Database | null = getDb(),
): Promise<PackageActivity> {
  if (!db) return emptyActivity();
  try {
    // Unprepared queries (transaction pooler) cannot bind a Date; send ISO text.
    const day = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - ACTIVITY_DAYS * day).toISOString();
    const verifySince = new Date(Date.now() - VERIFY_DAYS * day).toISOString();
    const rows = await db.execute<PackageActivityRow>(sql`
      with opened as (
        select ecosystem, query_normalized as key, btrim(query) as name, created_at
        from package_searches
        where created_at >= ${since}
          and (
            metadata->>'page' = 'true'
            or metadata->>'tool' in ('get_package', 'get_security', 'analyse_package')
          )
      ),
      verified as (
        select distinct ecosystem, lower(btrim(hit.name)) as key
        from package_searches
        cross join lateral unnest(result_names) as hit(name)
        where created_at >= ${verifySince}
          and coalesce(metadata->>'page', '') <> 'true'
          and (
            metadata->>'tool' = 'search_packages'
            or metadata->>'tool' is null
          )
      )
      select
        opened.ecosystem,
        (array_agg(opened.name order by opened.created_at desc))[1] as name,
        count(*)::int as checks,
        max(opened.created_at) as last_checked
      from opened
      join verified using (ecosystem, key)
      group by opened.ecosystem, opened.key
    `);
    return groupPackageActivity([...rows]);
  } catch (error: unknown) {
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
    const message = cause instanceof Error ? cause.message : "activity query failed";
    if (!/password/i.test(message)) {
      console.error("Failed to load package activity:", message);
    }
    return emptyActivity();
  }
}
