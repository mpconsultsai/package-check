import axios from "axios";
import semver from "semver";
import { AppError } from "@/lib/api/errors";
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
import {
  fetchOpenSSFScorecard,
  resolveGithubProjectId,
} from "@/lib/data-fetchers/openssf-scorecard";
import {
  fetchNpmDepsDevVersionInsight,
  fetchTransitiveDependencyGraph,
  type TransitiveDependencyGraph,
} from "@/lib/data-fetchers/deps-dev";
import { listPackageDependencies, type PackageDependency } from "@/lib/packages/package-deps";
import { advisoryEcosystem, type PackageEcosystem } from "@/lib/packages/package-routes";
import { versionCheckVerdict } from "@/lib/packages/version-check";
import { DEFAULT_NPM_RELEASE_COOLDOWN_HOURS } from "@/lib/prefs/npm-release-cooldown-pref";
import {
  buildUpgradeAdvice,
  listStableVersions,
} from "@/lib/upgrade/upgrade-advisor";
import {
  loadUpgradeDetails,
  truncateUpgradeDetailsForAgent,
} from "@/lib/upgrade/upgrade-details";
import { loadReversePeerFits } from "@/lib/upgrade/project-reverse-peer-fit";
import { clientMetadata } from "@/lib/db/client-metadata";
import { recordPackageSearch } from "@/lib/db/package-searches";
import { currentMcpHeaders } from "@/lib/mcp/request-context";

const DEP_CAP = 40;
const ADVISORY_CAP = 15;
const GRAPH_NODE_CAP = 80;
const PROJECT_DEPS_CAP = 200;
const SCORECARD_CHECK_CAP = 20;
const NPM_REGISTRY_URL = "https://registry.npmjs.org";

/** npm deprecation message for a specific version, when present. */
const fetchNpmVersionDeprecated = async (
  packageName: string,
  version: string,
): Promise<string | null> => {
  try {
    const response = await axios.get(
      `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
      {
        timeout: 4_000,
        validateStatus: (status) => status === 200 || status === 404,
      },
    );
    if (response.status !== 200) return null;
    const raw = response.data?.deprecated;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (raw) return "This package has been deprecated";
    return null;
  } catch {
    return null;
  }
};

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

const compactScorecard = async (options: {
  packageName?: string;
  repository?: string;
}) => {
  const repository = options.repository?.trim() || "";
  const packageName = options.packageName?.trim() || "";
  let projectId = repository ? resolveGithubProjectId(repository) : null;

  if (!projectId && packageName) {
    const name = requirePackageNameForEcosystem(packageName, "npm");
    try {
      const { data } = await fetchNpmPackageData(name);
      projectId = resolveGithubProjectId(data.repository?.url);
    } catch {
      throw new AppError("Could not resolve package repository", 404);
    }
  }

  if (!projectId) {
    throw new AppError(
      "No GitHub repository linked. Pass repository (owner/repo or URL) or an npm package with a GitHub repo.",
      404,
    );
  }

  try {
    const scorecard = await fetchOpenSSFScorecard(projectId);
    const checks = [...scorecard.checks]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, SCORECARD_CHECK_CAP)
      .map((check) => ({
        name: check.name,
        score: check.score,
        reason: check.reason,
      }));
    return {
      projectId: scorecard.projectId,
      overallScore: scorecard.overallScore,
      scoredAt: scorecard.scoredAt,
      checks,
      truncated: scorecard.checks.length > SCORECARD_CHECK_CAP,
      scorecardViewerUrl: scorecard.scorecardViewerUrl,
      depsDevProjectUrl: scorecard.depsDevProjectUrl,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to load scorecard";
    throw new AppError(message, 502);
  }
};

/** OpenSSF Scorecard via deps.dev (GitHub projects; npm package resolves repo). */
export const getScorecard = async (options: {
  package?: string;
  repository?: string;
}) => {
  const packageName = options.package?.trim() || "";
  const repository = options.repository?.trim() || "";
  if (!packageName && !repository) {
    throw new AppError("package or repository is required", 400);
  }
  const scorecard = await compactScorecard({ packageName, repository });
  await recordMcpTool({
    tool: "get_scorecard",
    ecosystem: "npm",
    query: packageName || scorecard.projectId,
    resultNames: packageName ? [packageName] : [],
    metadata: {
      projectId: scorecard.projectId,
      overallScore: scorecard.overallScore,
    },
  });
  return scorecard;
};

const compactDependencyGraph = (
  graph: TransitiveDependencyGraph,
  nodeCap = GRAPH_NODE_CAP,
) => {
  const ranked = [...graph.nodes].sort((a, b) => {
    const rank = (relation: typeof a.relation) =>
      relation === "SELF" ? 0 : relation === "DIRECT" ? 1 : relation === "INDIRECT" ? 2 : 3;
    const advisoryBoost = (count: number) => (count > 0 ? 0 : 1);
    return (
      advisoryBoost(a.advisoryCount) - advisoryBoost(b.advisoryCount) ||
      rank(a.relation) - rank(b.relation) ||
      b.advisoryCount - a.advisoryCount ||
      a.name.localeCompare(b.name)
    );
  });
  const nodes = ranked.slice(0, nodeCap).map((node) => ({
    name: node.name,
    version: node.version,
    relation: node.relation,
    advisoryCount: node.advisoryCount,
    advisoryIds: node.advisoryIds.slice(0, 5),
  }));
  const keep = new Set(nodes.map((node) => `${node.name}@${node.version}`));
  const edges = graph.edges
    .filter((edge) => keep.has(edge.from) && keep.has(edge.to))
    .slice(0, nodeCap * 2)
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.requirement ? { requirement: edge.requirement } : {}),
    }));
  return {
    ecosystem: "npm" as const,
    packageName: graph.packageName,
    version: graph.version,
    ...(graph.requestedVersion ? { requestedVersion: graph.requestedVersion } : {}),
    stats: graph.stats,
    nodes,
    edges,
    truncated: graph.nodes.length > nodes.length,
    depsDevUrl: graph.depsDevUrl,
  };
};

/** npm transitive graph from deps.dev (advisory counts on nodes). */
export const getDependencyGraph = async (
  rawName: string,
  version?: string,
) => {
  const packageName = requirePackageNameForEcosystem(rawName, "npm");
  let resolved = version?.trim() || "";
  if (!resolved) {
    try {
      const { data } = await fetchNpmPackageData(packageName);
      resolved = data.version?.trim() || "";
    } catch {
      throw new AppError("Could not resolve package version", 404);
    }
  }
  if (!resolved) throw new AppError("Version is required", 400);

  try {
    const graph = await fetchTransitiveDependencyGraph(packageName, resolved);
    const compact = compactDependencyGraph(graph);
    await recordMcpTool({
      tool: "get_dependency_graph",
      ecosystem: "npm",
      query: packageName,
      resultNames: [packageName],
      metadata: {
        version: compact.version,
        nodeCount: compact.stats.total,
        withAdvisories: compact.stats.withAdvisories,
      },
    });
    return compact;
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    const message =
      error instanceof Error ? error.message : "Failed to load dependency graph";
    throw new AppError(message, 502);
  }
};

/** use / wait / prefer_other / avoid for one package version. */
export const checkVersion = async (
  rawName: string,
  version: string,
  rawEcosystem?: string,
  cooldownHours?: number,
) => {
  const { packageName, ecosystem } = namedPackage(rawName, rawEcosystem);
  const selectedVersion = version.trim();
  if (!selectedVersion) throw new AppError("version is required", 400);

  const security = await checkPackageSecurity(
    packageName,
    selectedVersion,
    advisoryEcosystem(ecosystem),
  );

  let deprecated: string | null = null;
  let publishedAt: string | null = null;
  let versionTimes: Record<string, string> | null = null;
  let saferVersion: string | null = null;
  const cooldown =
    ecosystem === "npm"
      ? Math.max(
          0,
          Math.floor(
            Number(
              cooldownHours ?? DEFAULT_NPM_RELEASE_COOLDOWN_HOURS,
            ),
          ),
        )
      : 0;

  if (ecosystem === "npm") {
    const [packument, insight, deprecatedMessage] = await Promise.all([
      fetchNpmPackageData(packageName).catch(() => null),
      fetchNpmDepsDevVersionInsight(packageName, selectedVersion).catch(
        () => null,
      ),
      fetchNpmVersionDeprecated(packageName, selectedVersion),
    ]);
    versionTimes = packument?.data.time ?? null;
    publishedAt = versionTimes?.[selectedVersion] ?? null;
    deprecated = deprecatedMessage;
    saferVersion = insight?.saferVersion ?? null;
  }

  const check = versionCheckVerdict({
    selectedVersion,
    security: {
      totalCount: security.totalCount,
      critical: security.critical,
      high: security.high,
      moderate: security.moderate,
      low: security.low,
    },
    deprecated,
    saferVersion,
    publishedAt,
    cooldownHours: cooldown,
    versionTimes,
  });

  await recordMcpTool({
    tool: "check_version",
    ecosystem,
    query: packageName,
    resultNames: [packageName],
    metadata: {
      version: selectedVersion,
      verdict: check.verdict,
      cooldownHours: cooldown,
    },
  });

  return {
    ecosystem,
    name: packageName,
    version: selectedVersion,
    ...check,
    security: {
      totalCount: security.totalCount,
      critical: security.critical,
      high: security.high,
      moderate: security.moderate,
      low: security.low,
    },
  };
};

/** Reverse peer fit: will project packages accept this upgrade target? */
export const checkProjectFit = async (options: {
  package: string;
  to: string;
  projectDeps: Record<string, string>;
}) => {
  const packageName = requirePackageNameForEcosystem(options.package, "npm");
  const to = options.to.trim();
  if (!to || !semver.valid(to)) {
    throw new AppError("A concrete target version (to) is required", 400);
  }

  const projectDeps: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.projectDeps ?? {})) {
    if (typeof value !== "string" || !value.trim() || !name.trim()) continue;
    projectDeps[name.trim()] = value.trim();
    if (Object.keys(projectDeps).length >= PROJECT_DEPS_CAP) break;
  }
  if (Object.keys(projectDeps).length === 0) {
    throw new AppError("projectDeps must include at least one dependency", 400);
  }

  const result = await loadReversePeerFits({
    upgradePackage: packageName,
    targetVersion: to,
    projectDeps,
  });
  const conflicts = result.fits.filter((fit) => fit.status === "conflicts");

  await recordMcpTool({
    tool: "check_project_fit",
    ecosystem: "npm",
    query: packageName,
    resultNames: [packageName],
    metadata: {
      to,
      scanned: result.scanned,
      conflictCount: conflicts.length,
      truncated: result.truncated,
    },
  });

  return {
    ecosystem: "npm" as const,
    packageName,
    to,
    reversePeers: result.fits,
    conflicts,
    scanned: result.scanned,
    truncated: result.truncated,
  };
};
