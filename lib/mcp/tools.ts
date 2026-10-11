import { analyzePackageCached } from "@/lib/analysis-cache";
import {
  buildAnalysisResponse,
  type ClientAnalysisResponse,
} from "@/lib/analysis-response";
import { analyzePackageWithAI } from "@/lib/ai/analyzer";
import { parseEcosystem, requirePackageNameForEcosystem } from "@/lib/api/params";
import { checkPackageSecurity } from "@/lib/data-fetchers/security";
import { searchNpmPackages } from "@/lib/data-fetchers/npm-registry";
import { fetchNpmPackageData } from "@/lib/data-fetchers/npm-registry";
import { fetchPypiPackageData, searchPypiPackages } from "@/lib/data-fetchers/pypi-registry";
import {
  fetchNugetPackageData,
  searchNugetPackages,
} from "@/lib/data-fetchers/nuget-registry";
import { listPackageDependencies, type PackageDependency } from "@/lib/package-deps";
import { advisoryEcosystem, type PackageEcosystem } from "@/lib/package-routes";
import { recordPackageSearch } from "@/lib/db/package-searches";

const DEP_CAP = 40;
const ADVISORY_CAP = 15;

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
    qualityScore: report.metrics.qualityScore,
    daysSinceLastRelease: report.packageInfo.daysSinceLastRelease,
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
  return compactPackage(buildAnalysisResponse(packageName, data, null));
}

export async function analysePackage(rawName: string, rawEcosystem?: string) {
  const { packageName, ecosystem } = namedPackage(rawName, rawEcosystem);
  const data = await analyzePackageCached(packageName, ecosystem);
  let ai = null;
  let aiError: string | null = null;
  try {
    ai = await analyzePackageWithAI(data);
  } catch (error: unknown) {
    aiError = error instanceof Error ? error.message : "AI analysis failed";
  }
  const report = buildAnalysisResponse(packageName, data, ai);
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
        : await searchNpmPackages(text, take);
  await recordPackageSearch({
    ecosystem,
    query: text,
    resultNames: packages.map((item) => item.name),
    source: "mcp",
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
  const security = await checkPackageSecurity(
    packageName,
    version.trim(),
    advisoryEcosystem(ecosystem),
  );
  return {
    ecosystem,
    name: packageName,
    version: version.trim(),
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

export async function getDependencies(rawName: string, rawEcosystem?: string) {
  const { packageName, ecosystem } = namedPackage(rawName, rawEcosystem);
  if (ecosystem === "pypi") {
    const { data, pypiInstall } = await fetchPypiPackageData(packageName);
    return {
      ecosystem,
      name: data.name || packageName,
      version: data.version,
      requiresPython: pypiInstall.requiresPython,
      extras: pypiInstall.providesExtra,
      ...capDependencies(pypiInstall.core),
    };
  }
  if (ecosystem === "nuget") {
    const { data } = await fetchNugetPackageData(packageName);
    return {
      ecosystem,
      name: data.name || packageName,
      version: data.version,
      targetFramework: data.engines?.dotnet ?? null,
      ...capDependencies(listPackageDependencies(data.dependencies)),
    };
  }
  const { data } = await fetchNpmPackageData(packageName);
  return {
    ecosystem,
    name: data.name || packageName,
    version: data.version,
    ...capDependencies(
      listPackageDependencies(data.dependencies, data.peerDependencies),
    ),
  };
}
