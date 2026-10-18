import { formatBytes } from "@/lib/utils/format";
import { distributionSizeCaption } from "@/lib/data-fetchers/pypi-distribution-size";
import type { BundleModuleShare } from "@/lib/packages/npm-package-facts";

interface MetricsCardProps {
  metrics: {
    downloads: number;
    stars: number;
    openIssues: number;
    qualityScore: number;
    releaseCount?: number;
    bundleSize?: number;
    bundleGzip?: number;
    bundleComposition?: BundleModuleShare[] | null;
    distributionSize?: number;
    distributionSizeKind?: string;
    distributionFilename?: string;
  };
  showDownloads?: boolean;
  /** NuGet downloads are a lifetime total. npm downloads are monthly. */
  downloadsAreTotal?: boolean;
  /** Omit the outer card chrome when nested in another panel */
  embedded?: boolean;
}

export function MetricsCard({
  metrics,
  showDownloads = true,
  downloadsAreTotal = false,
  embedded = false,
}: MetricsCardProps) {
  const hasBundleSize =
    metrics.bundleSize !== undefined && metrics.bundleGzip !== undefined;
  const hasDistributionSize =
    typeof metrics.distributionSize === "number" &&
    metrics.distributionSize > 0;
  const distributionCaption =
    metrics.distributionSizeKind != null
      ? distributionSizeCaption({
          bytes: metrics.distributionSize!,
          packagetype: metrics.distributionSizeKind,
          filename: metrics.distributionFilename,
        })
      : null;
  const hasReleaseCount =
    typeof metrics.releaseCount === "number" && metrics.releaseCount > 0;
  const bundleComposition = (metrics.bundleComposition ?? []).filter(
    (mod) => mod.share >= 0.05,
  );

  const body = (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-6 sm:gap-4">
        {showDownloads && (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {downloadsAreTotal ? "Downloads" : "Downloads (month)"}
            </p>
            <p className="text-2xl font-bold break-words">
              {metrics.downloads.toLocaleString()}
            </p>
          </div>
        )}
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            GitHub Stars
          </p>
          <p className="text-2xl font-bold break-words">
            {metrics.stars.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Open Issues
          </p>
          <p className="text-2xl font-bold">
            {metrics.openIssues.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Quality Score*
          </p>
          <p className="text-2xl font-bold">{metrics.qualityScore}/100</p>
        </div>
        {hasReleaseCount && (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Releases
            </p>
            <p className="text-2xl font-bold">
              {metrics.releaseCount!.toLocaleString()}
            </p>
          </div>
        )}
        {hasBundleSize && (
          <>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Bundle (min)
              </p>
              <p className="text-2xl font-bold">
                {formatBytes(metrics.bundleSize!)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Bundle (gzip)
              </p>
              <p className="text-2xl font-bold">
                {formatBytes(metrics.bundleGzip!)}
              </p>
            </div>
          </>
        )}
        {hasDistributionSize && (
          <div className="min-w-0">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Install file size
            </p>
            <p className="text-2xl font-bold">
              {formatBytes(metrics.distributionSize!)}
            </p>
            {distributionCaption && (
              <div className="mt-0.5 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                <p>{distributionCaption.context}</p>
                <p
                  className="truncate"
                  title={distributionCaption.title}
                >
                  {distributionCaption.fileLabel}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {bundleComposition.length > 0 && (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
            Largest modules
          </span>
          <span className="mt-1 block font-mono text-sm text-ink">
            {bundleComposition
              .map((mod) => `${mod.name} ${Math.round(mod.share * 100)}%`)
              .join(" · ")}
          </span>
        </p>
      )}
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        *Quality score is calculated from GitHub stars or dependents
        {showDownloads
          ? downloadsAreTotal
            ? ", total downloads,"
            : ", monthly downloads,"
          : ","} time since last publish,
        and known vulnerabilities.
      </p>
    </>
  );

  if (embedded) return body;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
      {body}
    </div>
  );
}
