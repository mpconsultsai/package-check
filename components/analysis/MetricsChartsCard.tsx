"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { registryLabel } from "@/lib/package-routes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactNumber, formatPublishDate } from "@/lib/utils/format";
import { fetchJson } from "@/lib/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import {
  buildReleaseCadence,
  buildReleaseTypeMix,
  type ReleaseTypeMixResult,
} from "@/lib/release-cadence";

interface ChartPoint {
  date: string;
  value: number;
}

interface ChartsPayload {
  downloads: ChartPoint[];
  issues: ChartPoint[];
  downloadsGranularity?: "week" | "day";
  downloadsNote?: string;
}

function formatTickDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function formatTooltipDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

/** Recharts needs a non-zero box; skip render until layout gives dimensions. */
function ChartFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = (width: number, height: number) => {
      if (width > 0 && height > 0) {
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      } else {
        setSize(null);
      }
    };

    update(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-52 w-full min-w-0 overflow-hidden">
      {size ? (
        <ResponsiveContainer width={size.width} height={size.height}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}

function githubChartLinks(repository?: string | null): {
  releases: string;
  issues: string;
} | null {
  if (!repository) return null;
  const match = repository.match(/github\.com[:/]([^/]+)\/([^/\s#?]+)/i);
  if (!match) return null;
  const repo = match[2].replace(/\.git$/i, "");
  const base = `https://github.com/${match[1]}/${repo}`;
  return {
    releases: `${base}/releases`,
    issues: `${base}/issues`,
  };
}

function ChartExternalLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="link text-sm shrink-0"
    >
      {children}
    </a>
  );
}

function MetricLineChart({
  title,
  color,
  points,
  empty,
  seriesName = "Current",
  compareName,
  compareColor = "#c8431b",
  comparePoints,
  externalLink,
}: {
  title: string;
  color: string;
  points: ChartPoint[];
  empty: string;
  seriesName?: string;
  compareName?: string | null;
  compareColor?: string;
  comparePoints?: ChartPoint[];
  externalLink?: { href: string; label: string };
}) {
  const showCompare = Boolean(
    compareName && comparePoints && comparePoints.length > 0,
  );

  const data = useMemo(() => {
    const primaryMap = new Map(points.map((p) => [p.date, p.value]));
    const compareMap = new Map(
      (comparePoints ?? []).map((p) => [p.date, p.value]),
    );
    const dates = new Set<string>([
      ...primaryMap.keys(),
      ...(showCompare ? compareMap.keys() : []),
    ]);

    return [...dates]
      .sort((a, b) => a.localeCompare(b))
      .map((date) => ({
        date,
        value: primaryMap.get(date) ?? null,
        compare: showCompare ? (compareMap.get(date) ?? null) : null,
      }));
  }, [points, comparePoints, showCompare]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {title}
        </p>
        {externalLink ? (
          <ChartExternalLink href={externalLink.href}>
            {externalLink.label}
          </ChartExternalLink>
        ) : null}
      </div>
      {points.length < 2 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8">
          {empty}
        </p>
      ) : (
        <>
          {showCompare && (
            <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
              <li className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                {seriesName}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: compareColor }}
                  aria-hidden="true"
                />
                {compareName}
              </li>
            </ul>
          )}
          <ChartFrame>
              <LineChart
                key={`downloads-${compareName ?? "solo"}`}
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#a09a8b"
                  opacity={0.25}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#7a7569", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={28}
                  tickFormatter={formatTickDate}
                />
                <YAxis
                  tick={{ fill: "#7a7569", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v: number) => formatCompactNumber(v)}
                />
                <Tooltip
                  formatter={(value, name) => [
                    typeof value === "number"
                      ? value.toLocaleString()
                      : String(value ?? ""),
                    name === "compare" ? compareName || "Compare" : seriesName,
                  ]}
                  labelFormatter={(label) =>
                    typeof label === "string"
                      ? new Date(`${label}T00:00:00`).toLocaleDateString(
                          "en-GB",
                          {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          },
                        )
                      : ""
                  }
                  contentStyle={{
                    backgroundColor: "#25231f",
                    border: "1px solid #3d3a35",
                    borderRadius: 8,
                    color: "#ede9e0",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="value"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
                {showCompare && (
                  <Line
                    type="monotone"
                    dataKey="compare"
                    name="compare"
                    stroke={compareColor}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
          </ChartFrame>
        </>
      )}
    </div>
  );
}

/** Histogram of publishes per month - right chart for release cadence. */
function ReleaseCadenceChart({
  points,
  registryLabel = "npm",
}: {
  points: ChartPoint[];
  registryLabel?: string;
}) {
  const data = points.map((p) => ({
    ...p,
    label: formatTickDate(p.date),
  }));
  const total = points.reduce((sum, p) => sum + p.value, 0);

  return (
    <div>
      <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
        Release cadence
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {registryLabel} publishes per month
        {total > 0 ? ` · ${total.toLocaleString()} in view` : ""}
      </p>
      {data.length < 1 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8">
          No release history available.
        </p>
      ) : (
        <ChartFrame>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#a09a8b" opacity={0.25} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#7a7569", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#7a7569", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                formatter={(value) => [
                  typeof value === "number"
                    ? `${value} release${value === 1 ? "" : "s"}`
                    : String(value ?? ""),
                  "Published",
                ]}
                labelFormatter={(_, payload) =>
                  payload?.[0]?.payload?.date
                    ? formatTooltipDate(payload[0].payload.date)
                    : ""
                }
                contentStyle={{
                  backgroundColor: "#25231f",
                  border: "1px solid #3d3a35",
                  borderRadius: 8,
                  color: "#ede9e0",
                }}
              />
              <Bar
                dataKey="value"
                fill="#c8431b"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
        </ChartFrame>
      )}
    </div>
  );
}

/**
 * Overall major/minor/patch share - clearer for adoption decisions than
 * monthly stacked bars.
 */
function ReleaseTypeMixChart({ mix }: { mix: ReleaseTypeMixResult }) {
  const { totals, recentMajors } = mix;
  if (totals.all < 1) {
    return (
      <div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
          Release type mix
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
          No stable release history available.
        </p>
      </div>
    );
  }

  const pctLabel = (n: number) => {
    if (n <= 0 || totals.all < 1) return "0%";
    const rounded = Math.round((n / totals.all) * 100);
    return rounded < 1 ? "<1%" : `${rounded}%`;
  };
  const segments = [
    {
      key: "major" as const,
      label: "Major",
      count: totals.major,
      swatch: "bg-blue-900",
    },
    {
      key: "minor" as const,
      label: "Minor",
      count: totals.minor,
      swatch: "bg-blue-500",
    },
    {
      key: "patch" as const,
      label: "Patch",
      count: totals.patch,
      swatch: "bg-emerald-500",
    },
  ].filter((s) => s.count > 0);

  return (
    <div className="relative isolate">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
        Release type mix
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Share of stable semver bumps in the last ~3 years · higher major share
        can mean more breaking upgrades
      </p>

      <div
        className="flex h-3.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${pctLabel(s.count)}`)
          .join(", ")}
      >
        {segments.map((seg, index) => (
          <div
            key={seg.key}
            className={`h-full ${seg.swatch} ${
              index === 0 || index === segments.length - 1 ? "min-w-2" : ""
            }`}
            style={{ flex: `${seg.count} 1 0%` }}
            title={`${seg.label}: ${seg.count} (${pctLabel(seg.count)})`}
          />
        ))}
      </div>

      <div className="mt-2 flex h-4 flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-4 text-gray-600 dark:text-gray-400">
        {segments.map((seg) => (
          <span
            key={seg.key}
            className="inline-flex h-4 items-center gap-1.5"
          >
            <span
              className={`inline-block size-2.5 shrink-0 rounded-full ${seg.swatch}`}
              aria-hidden="true"
            />
            <span className="leading-4">
              {seg.label}{" "}
              <span className="tabular-nums text-gray-500 dark:text-gray-400">
                {pctLabel(seg.count)} · {seg.count}
              </span>
            </span>
          </span>
        ))}
      </div>

      {recentMajors.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            Recent major releases
          </p>
          <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {recentMajors.map((m) => (
              <li
                key={`${m.version}-${m.date}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
              >
                <span className="font-mono text-sm font-semibold">v{m.version}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatPublishDate(m.date) ?? "-"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div>
      <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-3" />
      <div className="h-52 w-full rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
    </div>
  );
}

function DownloadsChartSkeleton() {
  return (
    <div>
      <div className="mb-3 h-10 w-full md:w-1/2 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-3" />
      <div className="h-52 w-full rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
    </div>
  );
}

export function MetricsChartsCard({
  packageName,
  ecosystem = "npm",
  showDownloads = true,
  repository,
  versionTimes,
  keywords,
  competitors,
}: {
  packageName: string;
  ecosystem?: import("@/lib/package-routes").PackageEcosystem;
  showDownloads?: boolean;
  repository?: string | null;
  versionTimes?: Record<string, string>;
  keywords?: string[] | null;
  competitors?: string[] | null;
}) {
  const registryName = registryLabel(ecosystem);
  const keywordsKey = (keywords ?? []).join(",");
  const competitorsKey = (competitors ?? []).join(",");
  const [data, setData] = useState<ChartsPayload>({
    downloads: [],
    issues: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loadingDownloads, setLoadingDownloads] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const [relatedNames, setRelatedNames] = useState<string[]>([]);
  const [compareWith, setCompareWith] = useState("");
  const [compareDownloads, setCompareDownloads] = useState<ChartPoint[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [chartSection, setChartSection] = useState<
    "downloads" | "releases" | "issues"
  >(() => (showDownloads ? "downloads" : "releases"));
  const compareRequestId = useRef(0);
  const compareCacheRef = useRef<Record<string, ChartPoint[]>>({});

  const releasePoints = useMemo(
    () => buildReleaseCadence(versionTimes, 36),
    [versionTimes],
  );
  const releaseTypeMix = useMemo(
    () => buildReleaseTypeMix(versionTimes, 36),
    [versionTimes],
  );
  const githubLinks = useMemo(
    () => githubChartLinks(repository),
    [repository],
  );

  useEffect(() => {
    if (!packageName) return;
    const controller = new AbortController();

    const load = async (
      series: "downloads" | "issues",
      apply: (payload: ChartsPayload) => void,
      done: () => void,
    ) => {
      try {
        const { ok, data: payload } = await fetchJson<
          ChartsPayload & { error?: string }
        >(
          `${apiPaths.packages.charts}?package=${encodeURIComponent(packageName)}&series=${series}&ecosystem=${ecosystem}`,
          {
            signal: controller.signal,
            timeoutMs: 60_000,
            retries: 3,
          },
        );
        if (controller.signal.aborted) return;
        if (!ok || payload.error) {
          setError(payload.error || "Failed to load charts");
          return;
        }
        apply(payload);
      } catch {
        if (controller.signal.aborted) return;
        setError("Failed to load charts");
      } finally {
        if (!controller.signal.aborted) done();
      }
    };

    setLoadingDownloads(showDownloads);
    setLoadingIssues(true);
    setLoadingRelated(showDownloads);
    setError(null);
    setData({
      downloads: [],
      issues: [],
      downloadsGranularity: "week",
      downloadsNote: undefined,
    });
    setRelatedNames([]);
    setCompareWith("");
    setCompareDownloads([]);
    setChartSection(showDownloads ? "downloads" : "releases");
    compareCacheRef.current = {};
    compareRequestId.current += 1;

    if (showDownloads) {
      void load(
        "downloads",
        (payload) =>
          setData((current) => ({
            ...current,
            downloads: payload.downloads || [],
            downloadsGranularity: payload.downloadsGranularity ?? "week",
            downloadsNote: payload.downloadsNote,
          })),
        () => setLoadingDownloads(false),
      );
    } else {
      setLoadingDownloads(false);
    }
    void load(
      "issues",
      (payload) =>
        setData((current) => ({ ...current, issues: payload.issues || [] })),
      () => setLoadingIssues(false),
    );

    return () => {
      controller.abort();
    };
  }, [packageName, ecosystem, showDownloads]);

  useEffect(() => {
    if (!packageName || !showDownloads) {
      setRelatedNames([]);
      setLoadingRelated(false);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ package: packageName });
    if (keywordsKey) params.set("keywords", keywordsKey);
    if (competitorsKey) params.set("competitors", competitorsKey);

    void fetchJson<{ packages?: { name: string }[] }>(
      `${apiPaths.packages.similar}?${params}`,
      { signal: controller.signal, timeoutMs: 45_000, retries: 2 },
    )
      .then(({ ok, data: payload }) => {
        if (controller.signal.aborted) return;
        const names = ok
          ? (payload.packages ?? [])
              .map((pkg) => pkg.name)
              .filter(
                (name) =>
                  name.toLowerCase() !== packageName.toLowerCase(),
              )
          : [];
        setRelatedNames(names);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRelatedNames([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRelated(false);
      });

    return () => controller.abort();
  }, [packageName, ecosystem, keywordsKey, competitorsKey, showDownloads]);

  const downloadsReady = !loadingDownloads && !loadingRelated;
  const downloadsChartTitle =
    data.downloadsGranularity === "day"
      ? "Downloads (daily)"
      : "Downloads (weekly)";

  useEffect(() => {
    if (!showDownloads) {
      setCompareDownloads([]);
      setLoadingCompare(false);
      return;
    }
    if (!compareWith) {
      setCompareDownloads([]);
      setLoadingCompare(false);
      return;
    }

    const cacheKey = compareWith.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(compareCacheRef.current, cacheKey)) {
      setCompareDownloads(compareCacheRef.current[cacheKey]);
      setLoadingCompare(false);
      return;
    }

    const controller = new AbortController();
    const requestId = ++compareRequestId.current;
    setLoadingCompare(true);

    void fetchJson<ChartsPayload & { error?: string }>(
      `${apiPaths.packages.charts}?package=${encodeURIComponent(compareWith)}&series=downloads&ecosystem=${ecosystem}`,
      {
        signal: controller.signal,
        timeoutMs: 60_000,
        retries: 1,
      },
    )
      .then(({ ok, data: payload }) => {
        if (controller.signal.aborted || requestId !== compareRequestId.current) {
          return;
        }
        const points = ok ? payload.downloads || [] : [];
        // Only cache successful series so a failed attempt can be retried.
        if (ok && points.length > 0) {
          compareCacheRef.current[cacheKey] = points;
        }
        setCompareDownloads(points);
      })
      .catch(() => {
        if (controller.signal.aborted || requestId !== compareRequestId.current) {
          return;
        }
        setCompareDownloads([]);
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requestId === compareRequestId.current
        ) {
          setLoadingCompare(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [compareWith, ecosystem, showDownloads]);

  const chartTypeOptions = (
    [
      ...(showDownloads
        ? [{ id: "downloads" as const, label: "Downloads" }]
        : []),
      { id: "releases" as const, label: "Releases" },
      { id: "issues" as const, label: "Issues" },
    ] as const
  );

  useEffect(() => {
    if (showDownloads) return;
    setChartSection((current) =>
      current === "downloads" ? "releases" : current,
    );
  }, [showDownloads]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
      <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
        {showDownloads
          ? "Trends for downloads, releases, and open issues."
          : "Trends for releases and open issues."}
      </p>
      <div
        role="radiogroup"
        aria-label="Chart type"
        className="flex gap-5 mb-4 border-b border-rule"
      >
        {chartTypeOptions.map((option) => {
          const selected = chartSection === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setChartSection(option.id)}
              className={`-mb-px pb-2 text-sm font-medium border-b-2 transition-colors ${
                selected
                  ? "border-signal font-semibold text-ink"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {error && chartSection !== "releases" && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
      )}

      {chartSection === "downloads" &&
        (!downloadsReady ? (
          <DownloadsChartSkeleton />
        ) : (
          <div>
            {relatedNames.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label htmlFor="downloadsCompareSelect" className="sr-only">
                  Compare
                </label>
                <select
                  id="downloadsCompareSelect"
                  value={compareWith}
                  onChange={(e) => setCompareWith(e.target.value)}
                  className="w-full md:w-1/2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                >
                  <option value="">Select package to compare</option>
                  {relatedNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {loadingCompare && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Loading…
                  </span>
                )}
              </div>
            )}
            {ecosystem === "pypi" && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                PyPI download trend from pypistats.org
                {data.downloadsGranularity === "day"
                  ? " (recent daily counts)."
                  : " (recent daily data, aggregated weekly)."}
              </p>
            )}
            {data.downloadsNote && (
              <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">
                {data.downloadsNote}
              </p>
            )}
            <MetricLineChart
              title={downloadsChartTitle}
              color="#3b4c6e"
              points={data.downloads}
              seriesName={packageName}
              compareName={
                compareWith && !loadingCompare ? compareWith : null
              }
              comparePoints={
                compareWith && !loadingCompare ? compareDownloads : undefined
              }
              empty="No download history available."
            />
          </div>
        ))}

      {chartSection === "releases" && (
        <div className="space-y-8">
          {githubLinks ? (
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
              <ChartExternalLink href={githubLinks.releases}>
                GitHub releases
              </ChartExternalLink>
            </div>
          ) : null}
          <ReleaseCadenceChart
            points={releasePoints}
            registryLabel={registryName}
          />
          <ReleaseTypeMixChart mix={releaseTypeMix} />
        </div>
      )}

      {chartSection === "issues" &&
        (loadingIssues ? (
          <ChartSkeleton />
        ) : (
          <MetricLineChart
            title="Open issues"
            color="#996b1d"
            points={data.issues}
            empty="No GitHub issue history for this package."
            externalLink={
              githubLinks
                ? { href: githubLinks.issues, label: "GitHub issues" }
                : undefined
            }
          />
        ))}
    </div>
  );
}
