import { AppError } from "@/lib/api/errors";
import { jsonOk, withHandler } from "@/lib/api/http";
import { requirePackageFromQueryWithEcosystem } from "@/lib/api/params";
import { fetchNpmPackageData } from "@/lib/data-fetchers/npm-registry";
import { fetchPypiPackageData } from "@/lib/data-fetchers/pypi-registry";
import { fetchNugetPackageData } from "@/lib/data-fetchers/nuget-registry";
import { fetchMavenPackageData } from "@/lib/data-fetchers/maven-registry";
import { fetchTransitiveDependencyGraph } from "@/lib/data-fetchers/deps-dev";
import {
  attachDirectAdvisories,
  listPackageDependencies,
} from "@/lib/packages/package-deps";

/** GET /api/v1/packages/dependencies?package=&ecosystem= */
export const GET = withHandler(
  async (request) => {
    const { packageName, ecosystem } =
      requirePackageFromQueryWithEcosystem(request);
    try {
      if (ecosystem === "pypi") {
        const { data, pypiInstall } = await fetchPypiPackageData(packageName);
        return jsonOk({
          name: data.name || packageName,
          version: data.version,
          dependencies: pypiInstall.core,
          pypi: {
            requiresPython: pypiInstall.requiresPython,
            providesExtra: pypiInstall.providesExtra,
            core: pypiInstall.core,
            conditional: pypiInstall.conditional,
            extras: pypiInstall.extras,
          },
        });
      }

      if (ecosystem === "nuget") {
        const { data } = await fetchNugetPackageData(packageName);
        return jsonOk({
          name: data.name || packageName,
          version: data.version,
          dependencies: listPackageDependencies(data.dependencies),
          targetFramework: data.engines?.dotnet ?? null,
        });
      }

      if (ecosystem === "maven") {
        const { data } = await fetchMavenPackageData(packageName);
        return jsonOk({
          name: data.name || packageName,
          version: data.version,
          dependencies: listPackageDependencies(data.dependencies),
        });
      }

      const { data } = await fetchNpmPackageData(packageName);
      let dependencies = listPackageDependencies(
        data.dependencies,
        data.peerDependencies,
      );
      if (dependencies.length > 0 && data.version) {
        try {
          const graph = await fetchTransitiveDependencyGraph(
            data.name || packageName,
            data.version,
          );
          dependencies = attachDirectAdvisories(dependencies, graph.nodes);
        } catch {
          // The declared list still stands when deps.dev is unavailable.
        }
      }
      return jsonOk({
        name: data.name || packageName,
        version: data.version,
        dependencies,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load dependencies";
      throw new AppError(message, /not found/i.test(message) ? 404 : 500);
    }
  },
  {
    logLabel: "packages/dependencies",
    fallbackMessage: "Failed to load dependencies",
  },
);
