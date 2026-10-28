import { jsonOk, withHandler } from "@/lib/api/http";
import { requirePackageFromQueryWithEcosystem } from "@/lib/api/params";
import {
  aggregateDownloadsForCharts,
  fetchNpmDownloadTrends,
  fetchNpmPackageData,
} from "@/lib/data-fetchers/npm-registry";
import { fetchPypiPackageData } from "@/lib/data-fetchers/pypi-registry";
import { fetchNugetPackageData } from "@/lib/data-fetchers/nuget-registry";
import { fetchMavenPackageData } from "@/lib/data-fetchers/maven-registry";
import {
  fetchOpenIssuesByMonth,
  parseGitHubUrl,
} from "@/lib/data-fetchers/github";

const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
};

/** GET /api/v1/packages/charts?package=&series=&ecosystem= */
export const GET = withHandler(
  async (request) => {
    const { packageName, ecosystem } =
      requirePackageFromQueryWithEcosystem(request);
    const series = request.nextUrl.searchParams.get("series");

    const wantDownloads = series !== "issues";
    const wantIssues = series !== "downloads";

    let downloadsNote: string | undefined;

    const downloadsPromise =
      wantDownloads && ecosystem === "npm"
        ? fetchNpmDownloadTrends(packageName)
          .then((data) =>
            aggregateDownloadsForCharts(data.downloads || [], ecosystem),
          )
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            if (message.includes("rate-limited")) {
              downloadsNote = message;
            }
            return {
              points: [] as { date: string; value: number }[],
              granularity: "week" as const,
            };
          })
      : Promise.resolve({
          points: [] as { date: string; value: number }[],
          granularity: "week" as const,
        });

    let issuesPromise: Promise<{ date: string; value: number }[]> =
      Promise.resolve([]);

    if (wantIssues) {
      issuesPromise = (
        ecosystem === "pypi"
          ? fetchPypiPackageData(packageName)
          : ecosystem === "nuget"
            ? fetchNugetPackageData(packageName)
            : ecosystem === "maven"
              ? fetchMavenPackageData(packageName)
              : fetchNpmPackageData(packageName)
      )
        .then(({ data: meta }) => {
          const githubInfo = meta.repository?.url
            ? parseGitHubUrl(meta.repository.url)
            : null;
          if (!githubInfo) return [];
          return withTimeout(
            fetchOpenIssuesByMonth(githubInfo.owner, githubInfo.repo).catch(
              () => [],
            ),
            8000,
            [],
          );
        })
        .catch(() => []);
    }

    const [downloadSeries, issues] = await Promise.all([
      downloadsPromise,
      issuesPromise,
    ]);

    return jsonOk({
      downloads: downloadSeries.points,
      downloadsGranularity: downloadSeries.granularity,
      downloadsNote,
      issues,
    });
  },
  { logLabel: "packages/charts", fallbackMessage: "Failed to load charts" },
);
