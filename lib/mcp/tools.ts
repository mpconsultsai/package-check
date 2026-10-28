import semver from "semver";
import { analyzePackageCached } from "@/lib/packages/analysis-cache";
import {
  buildAnalysisResponse,
  type ClientAnalysisResponse,
} from "@/lib/packages/analysis-response";
import { reviewPackage } from "@/lib/ai/analyzer";
import { parseEcosystem, requirePackageNameForEcosystem } from "@/lib/api/params";
import { checkPackageSecurity } from "@/lib/data-fetchers/security";
import { searchNpmPackages } from "@/lib/data-fetchers/npm-registry";
import { fetchNpmPackageData } from "@/lib/data-fetchers/npm-registry";
import { fetchPypiPackageData, searchPypiPackages } from "@/lib/data-fetchers/pypi-registry";
import {
  fetchNugetPackageData,
  searchNugetPackages,
} from "@/lib/data-fetchers/nuget-registry";
import {
  fetchMavenPackageData,
  searchMavenPackages,
} from "@/lib/data-fetchers/maven-registry";
import { listPackageDependencies, type PackageDependency } from "@/lib/packages/package-deps";
import { advisoryEcosystem, type PackageEcosystem } from "@/lib/packages/package-routes";
import {
  buildUpgradeAdvice,
  listStableVersions,
} from "@/lib/upgrade/upgrade-advisor";
import {
  loadUpgradeDetails,
  truncateUpgradeDetailsForAgent,
} from "@/lib/upgrade/upgrade-details";
import { clientMetadata } from "@/lib/db/client-metadata";
import { recordPackageSearch } from "@/lib/db/package-searches";
import { currentMcpHeaders } from "@/lib/mcp/request-context";

const DEP_CAP = 40;
const ADVISORY_CAP = 15;

function mcpMetadata(
  fields: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const headerList = currentMcpHeaders();
  return {
    ...fields,
    ...(headerList ? clientMetadata(headerList) : {}),
  };
}

async function recordMcpTool(event: {
  tool: string;
  ecosystem: PackageEcosystem;
  query: string;
  resultNames: string[];
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await recordPackageSearch({
    ecosystem: event.ecosystem,
    query: event.query,
    resultNames: event.resultNames,
    source: "mcp",
    metadata: mcpMetadata({ tool: event.tool, ...event.metadata }),
  });
}

function namedPackage(rawName: string, rawEcosystem?: string): {
  packageName: string;
  ecosystem: PackageEcosystem;
} {
  const ecosystem = parseEcosystem(rawEcosystem);
  return {
    ecosystem,
    packageName: requirePackageNameForEcosystem(rawName, ecosystem),
  };
}

function capDependencies(dependencies: PackageDependency[]) {
  return {
    count: dependencies.length,
    dependencies: dependencies.slice(0, DEP_CAP).map((dep) => ({
      name: dep.name,
      range: dep.range,
      kind: dep.kind,
      ...(dep.marker ? { marker: dep.marker } : {}),
    })),
    ...(dependencies.length > DEP_CAP ? { truncated: true } : {}),
  };
}

export function compactPackage(report: ClientAnalysisResponse) {
  const security = report.security;
  return {
    ecosystem: report.ecosystem,
    name: report.packageInfo.name,
    version: report.packageInfo.latestVersion,
    description: report.packageInfo.description,
    license: report.packageInfo.license,
    registryUrl: report.packageInfo.registryUrl,
    homepage: report.packageInfo.homepage ?? null,
    repository: report.packageInfo.repository ?? null,
    deprecated: report.npm?.deprecated ?? null,
    downloads: {
      count: report.metrics.downloads,
      period: report.downloads?.period ?? "month",
    },
    stars: report.metrics.stars,
    openIssues: report.metrics.openIssues,
    dependents: report.packageInfo.dependents ?? null,
    ...(report.ecosystem === "npm"
      ? {
          moduleFormat: report.packageInfo.moduleFormat,
          typesIncluded: report.packageInfo.typesIncluded,
          typesFor: report.packageInfo.typesFor ?? null,
          typesPackage: report.packageInfo.typesPackage ?? null,
          provenance: report.packageInfo.provenance ?? null,
          maintainers: report.packageInfo.maintainers,
          publishRiskNotes: report.packageInfo.publishRiskNotes ?? [],
          bundleComposition: report.metrics.bundleComposition ?? null,
        }
      : {}),
    qualityScore: report.metrics.qualityScore,
    daysSinceLastRelease: report.packageInfo.daysSinceLastRelease,
    directDependencyCount: report.packageInfo.directDependencyCount,
    supportedFrameworks: report.packageInfo.supportedFrameworks,
    security: {
      totalCount: security?.totalCount ?? 0,
      critical: security?.critical ?? 0,
      high: security?.high ?? 0,
      moderate: security?.moderate ?? 0,
      low: security?.low ?? 0,
    },
  };
}

export async function getPackageReport(rawName: string, rawEcosystem?: string) {
  const { packageName, ecosystem } = namedPackage(rawName, rawEcosystem);
  const data = await analyzePackageCached(packageName, ecosystem);
  const report = compactPackage(buildAnalysisResponse(packageName, data, null));
  await recordMcpTool({
    tool: "get_package",
    ecosystem,
    query: packageName,
    resultNames: [report.name],
    metadata: { version: report.version },
  });
  return report;
}

export async function analysePackage(rawName: string, rawEcosystem?: string) {
  const { packageName, ecosystem } = namedPackage(rawName, rawEcosystem);
  const data = await analyzePackageCached(packageName, ecosystem);
  let ai = null;
  let reviewPath: string[] = [];
  let aiError: string | null = null;
  try {
    const review = await reviewPackage(data);
    ai = review.analysis;
    reviewPath = review.toolCalls;
  } catch (error: unknown) {
    aiError = error instanceof Error ? error.message : "AI analysis failed";
  }
  const report = buildAnalysisResponse(packageName, data, ai);
  await recordMcpTool({
    tool: "analyse_package",
    ecosystem,
    query: packageName,
    resultNames: [packageName],
    metadata: {
      ...(ai ? { recommendation: ai.recommendation, overallScore: ai.overallScore } : {}),
    },
  });
  return {
    ...compactPackage(report),
    ai: ai
      ? {
          summary: ai.summary,
          recommendation: ai.recommendation,
          strengths: ai.strengths,
          concerns: ai.concerns,
          overallScore: ai.overallScore,
          securityRating: ai.securityRating,
          qualityRating: ai.qualityRating,
          maintenanceRating: ai.maintenanceRating,
          reasoning: ai.reasoning,
          competitors: ai.competitors ?? [],
          model: ai.model ?? null,
        }
      : null,
    reviewPath,
    aiError,
  };
}

export async function searchPackages(
  query: string,
  rawEcosystem?: string,
  limit = 8,
) {
  const ecosystem = parseEcosystem(rawEcosystem);
  const take = Math.min(Math.max(limit ?? 8, 1), 8);
  const started = Date.now();
  const text = query.trim();
  if (text.length < 2) {
    return { ecosystem, packages: [] };
  }
  const packages =
    ecosystem === "pypi"
      ? await searchPypiPackages(text, take)
      : ecosystem === "nuget"
        ? await searchNugetPackages(text, take)
        : ecosystem === "maven"
          ? await searchMavenPackages(text, take)
          : await searchNpmPackages(text, take);
  await recordMcpTool({
    tool: "search_packages",
    ecosystem,
    query: text,
    resultNames: packages.map((item) => item.name),
    metadata: { limit: take, durationMs: Date.now() - started },
  });
  return {
    ecosystem,
    packages: packages.map((item) => ({
      name: item.name,
      version: item.version,
      description: item.description,
    })),
  };
}

export async function getSecurity(
  rawName: string,
  version: string,
  rawEcosystem?: string,
) {
  const { packageName, ecosystem } = namedPackage(rawName, rawEcosystem);
  const checkedVersion = version.trim();
  const security = await checkPackageSecurity(
    packageName,
    checkedVersion,
    advisoryEcosystem(ecosystem),
  );
  await recordMcpTool({
    tool: "get_security",
    ecosystem,
    query: packageName,
    resultNames: [packageName],
    metadata: { version: checkedVersion, advisoryCount: security.totalCount },
  });
  return {
    ecosystem,
    name: packageName,
    version: checkedVersion,
    totalCount: security.totalCount,
    critical: security.critical,
    high: security.high,
    moderate: security.moderate,
    low: security.low,
    advisories: security.vulnerabilities.slice(0, ADVISORY_CAP).map((item) => ({
      id: item.id,
      cveId: item.cveId ?? null,
      severity: item.severity,
      title: item.title,
      url: item.url,
      vulnerableVersionRange: item.vulnerableVersionRange ?? null,
      patchedVersions: item.patchedVersions ?? null,
      knownExploited: item.knownExploited ?? false,
    })),
    truncated: security.vulnerabilities.length > ADVISORY_CAP,
  };
}

function latestStableVersion(
  version: string | undefined,
  times?: Record<string, string> | null,
): string | null {
  const stable = listStableVersions(times);
  const tagged = version?.trim() ?? "";
  if (tagged && semver.valid(tagged) && !semver.prerelease(tagged)) return tagged;
  return stable[0] ?? null;
}

/** npm only. Compare an installed version with latest, or with an explicit target. */
export async function upgradePackage(rawName: string, from: string, to?: string) {
  const packageName = requirePackageNameForEcosystem(rawName, "npm");
  const fromVersion = from.trim();
  if (!fromVersion) {
    throw new Error("A from version is required.");
  }
  const { data } = await fetchNpmPackageData(packageName);
  const latest = latestStableVersion(data.version, data.time);
  if (!latest) {
    throw new Error("Could not find a published npm version.");
  }
  const target = to?.trim() || latest;
  const advice = buildUpgradeAdvice({
    from: fromVersion,
    to: target,
    versionTimes: data.time,
    versions: listStableVersions(data.time),
  });
  const changes =
    advice.verdict === "patch" ||
    advice.verdict === "minor" ||
    advice.verdict === "major"
      ? truncateUpgradeDetailsForAgent(
          await loadUpgradeDetails(packageName, fromVersion, target),
        )
      : null;
  await recordMcpTool({
    tool: "upgrade_package",
    ecosystem: "npm",
    query: packageName,
    resultNames: [packageName],
    metadata: {
      from: fromVersion,
      to: target,
      verdict: advice.verdict,
    },
  });
  return {
    ecosystem: "npm" as const,
    name: data.name || packageName,
    latest,
    from: advice.from,
    to: advice.to,
    bump: advice.bump,
    verdict: advice.verdict,
    headline: advice.headline,
    summary: advice.summary,
    releasesBehind: advice.releasesBehind,
    majorsCrossed: advice.majorsCrossed,
    daysBetween: advice.daysBetween,
    intermediateMajors: advice.intermediateMajors,
    changes,
  };
}

export async function getDependencies(rawName: string, rawEcosystem?: string) {
  const { packageName, ecosystem } = namedPackage(rawName, rawEcosystem);
  if (ecosystem === "pypi") {
    const { data, pypiInstall } = await fetchPypiPackageData(packageName);
    const dependencies = capDependencies(pypiInstall.core);
    await recordMcpTool({
      tool: "get_dependencies",
      ecosystem,
      query: packageName,
      resultNames: dependencies.dependencies.map((dep) => dep.name),
      metadata: { version: data.version },
    });
    return {
      ecosystem,
      name: data.name || packageName,
      version: data.version,
      requiresPython: pypiInstall.requiresPython,
      extras: pypiInstall.providesExtra,
      ...dependencies,
    };
  }
  if (ecosystem === "nuget") {
    const { data } = await fetchNugetPackageData(packageName);
    const dependencies = capDependencies(listPackageDependencies(data.dependencies));
    await recordMcpTool({
      tool: "get_dependencies",
      ecosystem,
      query: packageName,
      resultNames: dependencies.dependencies.map((dep) => dep.name),
      metadata: { version: data.version },
    });
    return {
      ecosystem,
      name: data.name || packageName,
      version: data.version,
      targetFramework: data.engines?.dotnet ?? null,
      ...dependencies,
    };
  }
  if (ecosystem === "maven") {
    const { data } = await fetchMavenPackageData(packageName);
    const dependencies = capDependencies(listPackageDependencies(data.dependencies));
    await recordMcpTool({
      tool: "get_dependencies",
      ecosystem,
      query: packageName,
      resultNames: dependencies.dependencies.map((dep) => dep.name),
      metadata: { version: data.version },
    });
    return {
      ecosystem,
      name: data.name || packageName,
      version: data.version,
      ...dependencies,
    };
  }
  const { data } = await fetchNpmPackageData(packageName);
  const dependencies = capDependencies(
    listPackageDependencies(data.dependencies, data.peerDependencies),
  );
  await recordMcpTool({
    tool: "get_dependencies",
    ecosystem,
    query: packageName,
    resultNames: dependencies.dependencies.map((dep) => dep.name),
    metadata: { version: data.version },
  });
  return {
    ecosystem,
    name: data.name || packageName,
    version: data.version,
    ...dependencies,
  };
}
