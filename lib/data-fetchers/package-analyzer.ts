import type { PackageAnalysisResult, PackageEcosystem } from "../types/package-data";
import {
  fetchNpmPackageData,
  fetchNpmDownloadStats,
  fetchNpmPackagePopularity,
} from "./npm-registry";
import { fetchPypiPackageData } from "./pypi-registry";
import { fetchNugetPackageData } from "./nuget-registry";
import { fetchMavenPackageData } from "./maven-registry";
import { fetchGitHubDataFromUrl, parseGitHubUrl } from "./github";
import { checkPackageSecurity } from "./security";
import { fetchBundleSize } from "./bundlephobia";
import { advisoryEcosystem, registryLabel } from "@/lib/packages/package-routes";
import { publicRegistryMessage } from "@/lib/utils/error-message";

/**
 * Analyze a package by fetching data from multiple sources
 * This is the main entry point for package analysis
 */
export async function analyzePackage(
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): Promise<PackageAnalysisResult> {
  const result: PackageAnalysisResult = {
    packageName,
    ecosystem,
    errors: {},
  };

  if (ecosystem === "pypi" || ecosystem === "nuget" || ecosystem === "maven") {
    try {
      if (ecosystem === "pypi") {
        const { data, readme, distributionSize } =
          await fetchPypiPackageData(packageName);
        result.npm = data;
        result.readme = readme;
        result.distributionSize = distributionSize;
      } else if (ecosystem === "maven") {
        const { data, readme, distributionSize } =
          await fetchMavenPackageData(packageName);
        result.npm = data;
        result.readme = readme;
        result.distributionSize = distributionSize;
      } else {
        const { data, readme, distributionSize, totalDownloads } =
          await fetchNugetPackageData(packageName);
        result.npm = data;
        result.readme = readme;
        result.distributionSize = distributionSize;
        if (totalDownloads) {
          result.downloads = {
            downloads: totalDownloads,
            start: "",
            end: "",
            package: data.name,
            period: "total",
          };
        }
      }
    } catch (error: unknown) {
      const message = publicRegistryMessage(error, registryLabel(ecosystem));
      result.errors!.npm = message;
      throw new Error(message);
    }

    const version = result.npm.version;
    const repoUrl = result.npm.repository?.url;
    const canFetchGitHub = Boolean(repoUrl && parseGitHubUrl(repoUrl));
    const securityEcosystem = advisoryEcosystem(ecosystem);

    await Promise.all([
      (async () => {
        if (!canFetchGitHub || !repoUrl) return;
        try {
          const githubData = await fetchGitHubDataFromUrl(repoUrl);
          result.github = githubData.repoData;
          result.releases = githubData.releases;
        } catch (error: unknown) {
          result.errors!.github =
            error instanceof Error ? error.message : "GitHub fetch failed";
        }
      })(),
      (async () => {
        try {
          result.security = await checkPackageSecurity(
            packageName,
            version,
            securityEcosystem,
          );
        } catch (error: unknown) {
          result.errors!.security =
            error instanceof Error ? error.message : "Security check failed";
        }
      })(),
    ]);

    return result;
  }

  // Fetch npm registry data (required) - README comes from the same packument
  try {
    const { data, readme } = await fetchNpmPackageData(packageName);
    result.npm = data;
    result.readme = readme;
  } catch (error: unknown) {
    const message = publicRegistryMessage(error, "npm");
    result.errors!.npm = message;
    throw new Error(message);
  }

  const version = result.npm.version;
  const repoUrl = result.npm.repository?.url;
  const canFetchGitHub = Boolean(repoUrl && parseGitHubUrl(repoUrl));

  // Independent sources in parallel after we have npm metadata
  await Promise.all([
    (async () => {
      try {
        result.downloads = await fetchNpmDownloadStats(packageName);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Download stats failed";
        result.errors!.npm = `${result.errors!.npm || ""} ${message}`.trim();
      }
    })(),
    (async () => {
      try {
        const popularity = await fetchNpmPackagePopularity(packageName);
        if (popularity) {
          result.popularity = popularity;
        }
      } catch {
        console.warn(`Could not fetch popularity for ${packageName}`);
      }
    })(),
    (async () => {
      if (!canFetchGitHub || !repoUrl) return;
      try {
        const githubData = await fetchGitHubDataFromUrl(repoUrl);
        result.github = githubData.repoData;
        result.releases = githubData.releases;
      } catch (error: unknown) {
        result.errors!.github =
          error instanceof Error ? error.message : "GitHub fetch failed";
      }
    })(),
    (async () => {
      try {
        result.security = await checkPackageSecurity(packageName, version, "npm");
      } catch (error: unknown) {
        result.errors!.security =
          error instanceof Error ? error.message : "Security check failed";
      }
    })(),
    (async () => {
      try {
        result.bundleSize = await fetchBundleSize(packageName, version);
      } catch (error: unknown) {
        result.errors!.bundleSize =
          error instanceof Error ? error.message : "Bundle size fetch failed";
        result.bundleSize = null;
      }
    })(),
  ]);

  return result;
}
