import { formatDaysSinceRelease } from "@/lib/utils/format";
import type {
  PackageAnalysisResult,
  PackageEcosystem,
} from "@/lib/types/package-data";
import type { AIPackageAnalysis } from "@/lib/ai/analyzer";
import { classifyRuntimeEnvironment } from "@/lib/packages/runtime-environment";
import { licenseDisplayName } from "@/lib/packages/license-info";
import { npmMaintainerNames } from "@/lib/packages/npm-package-facts";
import { registryPackageUrl } from "@/lib/packages/package-routes";
import { isStableDotnetPlatformPackage } from "@/lib/nuget/dotnet-platform";

export function getDaysSinceLastRelease(
  packageData: PackageAnalysisResult,
): number | null {
  if (!packageData.npm?.time || !packageData.npm?.version) return null;
  const lastPublished = packageData.npm.time[packageData.npm.version];
  if (!lastPublished) return null;
  return Math.floor(
    (Date.now() - new Date(lastPublished).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function getPackageRuntime(packageData: PackageAnalysisResult) {
  const npm = packageData.npm;
  return classifyRuntimeEnvironment({
    name: npm?.name ?? packageData.packageName,
    description: npm?.description,
    keywords: npm?.keywords,
    dependencies: npm?.dependencies,
    peerDependencies: npm?.peerDependencies,
    browser: npm?.browser,
    bin: npm?.bin,
    engines: npm?.engines,
    exports: npm?.exports,
    hasBrowserBundle:
      packageData.bundleSize != null
        ? true
        : packageData.errors?.bundleSize
          ? false
          : undefined,
  });
}

/** Count published versions from the npm packument `time` map. */
export function countNpmReleases(
  time?: Record<string, string> | null,
): number {
  if (!time) return 0;
  return Object.keys(time).filter(
    (key) => !["created", "modified", "unpublished"].includes(key),
  ).length;
}

export function calculateQualityScore(
  packageData: PackageAnalysisResult,
): number {
  let score = 0;
  let factors = 0;

  const starsScore =
    packageData.github?.stars !== undefined
      ? packageData.github.stars >= 5000
        ? 25
        : packageData.github.stars >= 1000
          ? 22
          : packageData.github.stars >= 500
            ? 18
            : packageData.github.stars >= 100
              ? 14
              : packageData.github.stars >= 10
                ? 10
                : 5
      : 0;
  const dependentsScore = packageData.popularity?.dependents
    ? packageData.popularity.dependents >= 10000
      ? 25
      : packageData.popularity.dependents >= 1000
        ? 22
        : packageData.popularity.dependents >= 100
          ? 18
          : packageData.popularity.dependents >= 10
            ? 14
            : 5
    : 0;
  if (starsScore > 0 || dependentsScore > 0) {
    score += Math.max(starsScore, dependentsScore);
    factors++;
  }

  if (packageData.downloads?.downloads) {
    const downloads = packageData.downloads.downloads;
    const lifetime = packageData.downloads.period === "total";
    if (lifetime) {
      if (downloads >= 1_000_000_000) score += 25;
      else if (downloads >= 100_000_000) score += 22;
      else if (downloads >= 10_000_000) score += 18;
      else if (downloads >= 1_000_000) score += 14;
      else if (downloads >= 100_000) score += 10;
      else score += 5;
    } else if (downloads >= 10000000) score += 25;
    else if (downloads >= 1000000) score += 20;
    else if (downloads >= 100000) score += 15;
    else if (downloads >= 10000) score += 10;
    else score += 5;
    factors++;
  }

  if (packageData.npm?.time && packageData.npm.version) {
    const lastPublished = packageData.npm.time[packageData.npm.version];
    if (lastPublished) {
      const daysSince = Math.floor(
        (Date.now() - new Date(lastPublished).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      let maintenance = 5;
      if (daysSince < 90) maintenance = 25;
      else if (daysSince < 180) maintenance = 20;
      else if (daysSince < 365) maintenance = 15;
      else if (daysSince < 730) maintenance = 10;
      if (isStableDotnetPlatformPackage(packageData)) {
        maintenance = Math.max(maintenance, 20);
      }
      score += maintenance;
      factors++;
    }
  }

  if (packageData.security) {
    const issues = packageData.security.totalCount || 0;
    if (issues === 0) score += 20;
    else if (issues <= 2) score += 15;
    else if (issues <= 5) score += 10;
    else score += 5;
    factors++;
  }

  return factors > 0 ? Math.round((score / (factors * 25)) * 100) : 0;
}

export function buildAnalysisResponse(
  packageName: string,
  packageData: PackageAnalysisResult,
  aiAnalysis: AIPackageAnalysis | null = null,
) {
  const ecosystem: PackageEcosystem = packageData.ecosystem ?? "npm";
  const daysSinceLastRelease = getDaysSinceLastRelease(packageData);
  const runtime = getPackageRuntime(packageData);
  const registryUrl = registryPackageUrl(ecosystem, packageName);

  return {
    ...packageData,
    ecosystem,
    ai: aiAnalysis,
    packageInfo: {
      name: packageName,
      latestVersion: packageData.npm?.version || "Unknown",
      license: licenseDisplayName(packageData.npm?.license),
      npmUrl: registryUrl,
      registryUrl,
      description: packageData.npm?.description || "",
      homepage: packageData.npm?.homepage,
      repository: packageData.npm?.repository?.url,
      daysSinceLastRelease,
      lastReleaseLabel:
        daysSinceLastRelease !== null
          ? formatDaysSinceRelease(daysSinceLastRelease)
          : null,
      dependents: packageData.popularity?.dependents,
      keywords: packageData.npm?.keywords?.filter(
        (k): k is string => typeof k === "string" && k.trim().length > 0,
      ),
      engines: packageData.npm?.engines ?? null,
      installScripts: packageData.npm?.installScripts ?? null,
      moduleFormat:
        ecosystem === "npm" ? (packageData.npm?.moduleFormat ?? null) : null,
      typesIncluded:
        ecosystem === "npm" ? (packageData.npm?.typesIncluded ?? null) : null,
      typesFor: ecosystem === "npm" ? (packageData.npm?.typesFor ?? null) : null,
      typesPackage:
        ecosystem === "npm" ? (packageData.npm?.typesPackage ?? null) : null,
      provenance:
        ecosystem === "npm" ? (packageData.npm?.provenance ?? null) : null,
      maintainers:
        ecosystem === "npm"
          ? npmMaintainerNames(packageData.npm?.maintainers)
          : null,
      supportedFrameworks: packageData.npm?.supportedFrameworks ?? null,
      commonlyUsedTypes: packageData.npm?.commonlyUsedTypes ?? null,
      descriptionNote: packageData.npm?.descriptionNote ?? null,
      runtime: {
        kind: runtime.kind,
        label: runtime.label,
        confidence: runtime.confidence,
        reasons: runtime.reasons,
      },
    },
    metrics: {
      downloads: packageData.downloads?.downloads || 0,
      stars: packageData.github?.stars || 0,
      openIssues: packageData.github?.open_issues || 0,
      qualityScore: calculateQualityScore(packageData),
      releaseCount: countNpmReleases(packageData.npm?.time),
      ...(packageData.bundleSize
        ? {
            bundleSize: packageData.bundleSize.size,
            bundleGzip: packageData.bundleSize.gzip,
            bundleComposition: packageData.bundleSize.composition ?? null,
          }
        : {}),
      ...(packageData.distributionSize
        ? {
            distributionSize: packageData.distributionSize.bytes,
            distributionSizeKind: packageData.distributionSize.packagetype,
            distributionFilename: packageData.distributionSize.filename,
          }
        : {}),
    },
  };
}

/** JSON shape returned by `/api/v1/analysis/metrics` and `/api/v1/analysis/ai`. */
export type ClientAnalysisResponse = ReturnType<typeof buildAnalysisResponse>;
