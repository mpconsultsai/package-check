import { sql } from "drizzle-orm";
import type { PackageEcosystem } from "@/lib/package-routes";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";

const USAGE_DAYS = 30;
const ALSO_SHOWN_LIMIT = 6;

const RECOMMENDATIONS = [
  "recommended",
  "use-with-caution",
  "not-recommended",
  "do-not-use",
] as const;

export type UsageRecommendation = (typeof RECOMMENDATIONS)[number];

export type PackageUsageBrief = {
  opened: number;
  securityChecks: number;
  reviews: number;
  recommendations: Partial<Record<UsageRecommendation, number>>;
  alsoShownWith: string[];
};

function asCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function isRecommendation(value: string): value is UsageRecommendation {
  return (RECOMMENDATIONS as readonly string[]).includes(value);
}

/** One prompt line. Null when the package has no recorded interest. */
export function formatPackageUsageBrief(brief: PackageUsageBrief): string | null {
  const namedReviews = RECOMMENDATIONS.flatMap((key) => {
    const count = brief.recommendations[key] ?? 0;
    return count > 0 ? [`${key} ${count}`] : [];
  });
  if (
    brief.opened === 0 &&
    brief.securityChecks === 0 &&
    brief.reviews === 0 &&
    brief.alsoShownWith.length === 0
  ) {
    return null;
  }

  const reviews =
    brief.reviews > 0 && namedReviews.length > 0
      ? `AI reviews ${brief.reviews} (${namedReviews.join(", ")})`
      : `AI reviews ${brief.reviews}`;
  const parts = [
    `opened ${brief.opened}`,
    `security checks ${brief.securityChecks}`,
    reviews,
  ];
  const line = `pkglens usage, 30d: ${parts.join("; ")}`;
  if (brief.alsoShownWith.length === 0) return line;
  return `${line}. Also shown with: ${brief.alsoShownWith.join(", ")}`;
}

type CountRow = {
  opened: unknown;
  security_checks: unknown;
  reviews: unknown;
};

type RecommendationRow = {
  recommendation: unknown;
  count: unknown;
};

type AlsoShownRow = {
  name: unknown;
};

function failureMessage(error: unknown): string {
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  return cause instanceof Error ? cause.message : "usage query failed";
}

/** Recent anonymous interest for one package. Null when the database is unset or the query fails. */
export async function loadPackageUsageBrief(
  ecosystem: PackageEcosystem,
  packageName: string,
  db: Database | null = getDb(),
): Promise<string | null> {
  const name = packageName.trim().toLowerCase();
  if (!db || name.length < 2) return null;
  try {
    // Unprepared queries (transaction pooler) cannot bind a Date; send ISO text.
    const since = new Date(
      Date.now() - USAGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const counts = await db.execute<CountRow>(sql`
      select
        count(*) filter (
          where query_normalized = ${name}
            and (
              metadata->>'page' = 'true'
              or metadata->>'tool' = 'get_package'
            )
        )::int as opened,
        count(*) filter (
          where query_normalized = ${name}
            and metadata->>'tool' = 'get_security'
        )::int as security_checks,
        count(*) filter (
          where query_normalized = ${name}
            and metadata->>'tool' = 'analyse_package'
        )::int as reviews
      from package_searches
      where ecosystem = ${ecosystem}
        and created_at >= ${since}
    `);
    const recommendations = await db.execute<RecommendationRow>(sql`
      select metadata->>'recommendation' as recommendation, count(*)::int as count
      from package_searches
      where ecosystem = ${ecosystem}
        and created_at >= ${since}
        and query_normalized = ${name}
        and metadata->>'tool' = 'analyse_package'
      group by 1
    `);
    const alsoShown = await db.execute<AlsoShownRow>(sql`
      select min(btrim(shown.name)) as name, count(*) as hits
      from package_searches
      cross join lateral unnest(result_names) as shown(name)
      where ecosystem = ${ecosystem}
        and created_at >= ${since}
        and (
          metadata->>'tool' = 'search_packages'
          or metadata->>'tool' is null
        )
        and coalesce(metadata->>'page', '') <> 'true'
        and exists (
          select 1
          from unnest(package_searches.result_names) as hit(package_name)
          where lower(btrim(hit.package_name)) = ${name}
        )
        and lower(btrim(shown.name)) <> ${name}
        and length(btrim(shown.name)) >= 2
      group by lower(btrim(shown.name))
      order by hits desc, name
      limit ${ALSO_SHOWN_LIMIT}
    `);
    const countRow = counts[0];
    const recommendationCounts: PackageUsageBrief["recommendations"] = {};
    for (const row of recommendations) {
      if (typeof row.recommendation !== "string" || !isRecommendation(row.recommendation)) {
        continue;
      }
      recommendationCounts[row.recommendation] = asCount(row.count);
    }
    return formatPackageUsageBrief({
      opened: asCount(countRow?.opened),
      securityChecks: asCount(countRow?.security_checks),
      reviews: asCount(countRow?.reviews),
      recommendations: recommendationCounts,
      alsoShownWith: alsoShown.flatMap((row) =>
        typeof row.name === "string" && row.name.trim() ? [row.name.trim()] : [],
      ),
    });
  } catch (error: unknown) {
    const message = failureMessage(error);
    if (/password/i.test(message)) return null;
    console.error("Failed to load package usage:", message);
    return null;
  }
}
