"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import {
  dependencyReactKey,
  type PackageDependency,
} from "@/lib/package-deps";
import { describeDependencySpec } from "@/lib/describe-dependency-spec";
import { TransitiveDepsPanel } from "@/components/analysis/TransitiveDepsPanel";
import {
  packagePagePath,
  type PackageEcosystem,
} from "@/lib/package-routes";
import { featuresForEcosystem } from "@/lib/ecosystem-features";
import {
  combinePypiDepsForView,
  normalizePypiMeta,
  PypiDependenciesPanel,
  pypiHasAnyRequirements,
  type PypiDependenciesMeta,
} from "@/components/analysis/PypiDependenciesPanel";

const GRAPH_CAP = 18;

function KindBadge({
  kind,
  ecosystem,
}: {
  kind: PackageDependency["kind"];
  ecosystem: PackageEcosystem;
}) {
  if (ecosystem === "pypi") {
    return (
      <span className="inline-flex shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700 dark:bg-gray-700/70 dark:text-gray-200">
        Required
      </span>
    );
  }
  const peer = kind === "peer";
  return (
    <span
      className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        peer
          ? "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"
          : "bg-gray-100 text-gray-700 dark:bg-gray-700/70 dark:text-gray-200"
      }`}
    >
      {peer ? "Peer" : "Runtime"}
    </span>
  );
}

function DependencyRow({
  dep,
  depth = 0,
  ecosystem,
}: {
  dep: PackageDependency;
  depth?: number;
  ecosystem: PackageEcosystem;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<PackageDependency[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const explained = describeDependencySpec(dep.range);

  useEffect(() => {
    if (!open || children !== null) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetchJson<{
      dependencies?: PackageDependency[];
      error?: string;
    }>(`${apiPaths.packages.dependencies}?package=${encodeURIComponent(dep.name)}&ecosystem=${ecosystem}`, {
      signal: controller.signal,
      timeoutMs: 20_000,
      retries: 1,
    })
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        if (!ok) {
          setError(data.error || "Could not load dependencies");
          setChildren([]);
          return;
        }
        setChildren(data.dependencies ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Could not load dependencies");
          setChildren([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, children, dep.name, ecosystem]);

  const canExpand = depth < 1;

  return (
    <li>
      <div
        className="flex items-start gap-2 py-2"
        style={{ paddingLeft: depth > 0 ? `${depth}rem` : undefined }}
      >
        {canExpand ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={
              open
                ? `Hide dependencies of ${dep.name}`
                : `Show dependencies of ${dep.name}`
            }
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        ) : (
          <span className="mt-0.5 inline-block h-6 w-6 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={packagePagePath(ecosystem, dep.name)}
              className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 truncate"
            >
              {dep.name}
            </Link>
            <KindBadge kind={dep.kind} ecosystem={ecosystem} />
            {dep.marker ? (
              <span
                className="inline-flex max-w-[12rem] truncate rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                title={dep.marker}
              >
                conditional
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
            {dep.range}
            {explained ? ` · ${explained.label}` : ""}
          </p>
          {dep.marker ? (
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 font-mono break-all">
              ; {dep.marker}
            </p>
          ) : null}
        </div>
      </div>
      {open && (
        <div className="border-l border-gray-200 dark:border-gray-600 ml-3 sm:ml-4">
          {loading && (
            <p className="py-2 pl-4 text-xs text-gray-500 dark:text-gray-400">
              Loading…
            </p>
          )}
          {error && (
            <p className="py-2 pl-4 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {!loading && children && children.length === 0 && !error && (
            <p className="py-2 pl-4 text-xs text-gray-500 dark:text-gray-400">
              {ecosystem === "pypi"
                ? "No further install requirements."
                : "No further runtime or peer dependencies."}
            </p>
          )}
          {!loading && children && children.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700/80">
              {children.map((child, childIndex) => (
                <DependencyRow
                  key={dependencyReactKey(child, childIndex)}
                  dep={child}
                  depth={depth + 1}
                  ecosystem={ecosystem}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function DependencyList({
  deps,
  ecosystem,
}: {
  deps: PackageDependency[];
  ecosystem: PackageEcosystem;
}) {
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 px-2 sm:px-3">
      {deps.map((dep, index) => (
        <DependencyRow
          key={dependencyReactKey(dep, index)}
          dep={dep}
          ecosystem={ecosystem}
        />
      ))}
    </ul>
  );
}

function DependenciesGraph({
  packageName,
  dependencies,
  ecosystem,
}: {
  packageName: string;
  dependencies: PackageDependency[];
  ecosystem: PackageEcosystem;
}) {
  const visible = dependencies.slice(0, GRAPH_CAP);
  const overflow = dependencies.length - visible.length;
  const size = 400;
  const pad = 36;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 155;
  const nodeR = 16;
  const hubR = 26;
  const labelOffset = nodeR + 12;

  const nodes = visible.map((dep, index) => {
    const angle =
      (Math.PI * 2 * index) / Math.max(visible.length, 1) - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const lx = cx + Math.cos(angle) * (radius + labelOffset);
    const ly = cy + Math.sin(angle) * (radius + labelOffset);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const textAnchor: "start" | "middle" | "end" =
      cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle";
    const dy =
      sin > 0.45 ? "0.9em" : sin < -0.45 ? "-0.35em" : "0.35em";
    return { ...dep, angle, x, y, lx, ly, textAnchor, dy, graphIndex: index };
  });

  return (
    <div>
      {overflow > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Showing {visible.length} of {dependencies.length}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/30">
        <svg
          viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
          className="w-full h-auto max-h-[26rem]"
          role="img"
          aria-label={`Dependency graph for ${packageName}`}
        >
          {nodes.map((node) => (
            <line
              key={`edge-${dependencyReactKey(node, node.graphIndex)}`}
              x1={cx}
              y1={cy}
              x2={node.x}
              y2={node.y}
              stroke="currentColor"
              className="text-gray-300 dark:text-gray-600"
              strokeWidth={1.25}
            />
          ))}
          <a href={packagePagePath(ecosystem, packageName)}>
            <circle
              cx={cx}
              cy={cy}
              r={hubR}
              className="fill-blue-600 dark:fill-blue-500"
            />
            <title>{packageName}</title>
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-white text-[10px] font-semibold"
            >
              {packageName.length > 12
                ? `${packageName.slice(0, 11)}…`
                : packageName}
            </text>
          </a>
          {nodes.map((node) => {
            const peer = node.kind === "peer";
            return (
              <a
                key={`node-${dependencyReactKey(node, node.graphIndex)}`}
                href={packagePagePath(ecosystem, node.name)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={nodeR}
                  className={
                    peer
                      ? "fill-violet-500 dark:fill-violet-400"
                      : "fill-gray-700 dark:fill-gray-300"
                  }
                />
                <title>
                  {node.name}@{node.range} (
                  {ecosystem === "pypi"
                    ? "required"
                    : peer
                      ? "peer"
                      : "runtime"}
                  )
                </title>
                <text
                  x={node.lx}
                  y={node.ly}
                  textAnchor={node.textAnchor}
                  dy={node.dy}
                  className="fill-gray-800 dark:fill-gray-100 text-[10px] font-medium"
                >
                  {node.name}
                </text>
              </a>
            );
          })}
        </svg>
      </div>
      {ecosystem !== "pypi" ? (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-gray-700 dark:bg-gray-300" />
            Runtime
          </span>
          {ecosystem === "npm" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-violet-500" />
              Peer
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DependenciesSkeleton() {
  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6"
      role="status"
    >
      <span className="sr-only">Loading dependencies</span>
      <div className="space-y-3 animate-pulse" aria-hidden="true">
        <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-40 w-full rounded bg-gray-200 dark:bg-gray-700 hidden md:block" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>
    </div>
  );
}

export function DependenciesCard({
  packageName,
  ecosystem = "npm",
}: {
  packageName: string;
  ecosystem?: PackageEcosystem;
}) {
  const features = featuresForEcosystem(ecosystem);
  const [deps, setDeps] = useState<PackageDependency[] | null>(null);
  const [pypiMeta, setPypiMeta] = useState<PypiDependenciesMeta | null>(null);
  const [pypiExtra, setPypiExtra] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "list" | "transitive">("chart");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDeps(null);
    setPypiMeta(null);
    setPypiExtra(null);
    setView("chart");

    void fetchJson<{
      dependencies?: PackageDependency[];
      pypi?: PypiDependenciesMeta;
      error?: string;
    }>(`${apiPaths.packages.dependencies}?package=${encodeURIComponent(packageName)}&ecosystem=${ecosystem}`, {
      signal: controller.signal,
      timeoutMs: 20_000,
      retries: 1,
    })
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        if (!ok) {
          setError(data.error || "Could not load dependencies");
          setDeps([]);
          return;
        }
        if (ecosystem === "pypi" && data.pypi) {
          const meta = normalizePypiMeta(
            data.pypi,
            data.dependencies ?? [],
          );
          setPypiMeta(meta);
          setDeps(combinePypiDepsForView(meta, null));
        } else {
          setDeps(data.dependencies ?? []);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Could not load dependencies");
          setDeps([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [packageName, ecosystem]);

  useEffect(() => {
    if (!pypiMeta || ecosystem !== "pypi") return;
    setDeps(combinePypiDepsForView(pypiMeta, pypiExtra));
  }, [pypiMeta, pypiExtra, ecosystem]);

  const hasDepsToPlot = (deps?.length ?? 0) > 0;
  const showChartList = hasDepsToPlot;
  const showTransitiveTab = features.transitiveDepsTree && hasDepsToPlot;

  useEffect(() => {
    if (
      (!features.transitiveDepsTree || !hasDepsToPlot) &&
      view === "transitive"
    ) {
      setView("list");
    }
  }, [features.transitiveDepsTree, hasDepsToPlot, view]);

  useEffect(() => {
    if (!hasDepsToPlot && view === "chart") {
      setView("list");
    }
  }, [hasDepsToPlot, view]);

  const coreCount = pypiMeta?.core?.length ?? 0;
  const conditionalCount = pypiMeta?.conditional?.length ?? 0;
  const runtimeCount = (deps ?? []).filter((d) => d.kind === "runtime").length;
  const peerCount = (deps ?? []).filter((d) => d.kind === "peer").length;

  if (loading) return <DependenciesSkeleton />;

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  const pypiEmpty =
    ecosystem === "pypi" && pypiMeta && !pypiHasAnyRequirements(pypiMeta);

  if (ecosystem !== "pypi" && !hasDepsToPlot) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No runtime or peer dependencies declared for the latest version.
        </p>
      </div>
    );
  }

  if (
    ecosystem === "pypi" &&
    !hasDepsToPlot &&
    !pypiMeta?.requiresPython &&
    pypiEmpty
  ) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No install requirements declared for the latest release.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view !== "transitive" ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {ecosystem === "pypi"
              ? pypiExtra
                ? `Showing default + extra “${pypiExtra}” · ${runtimeCount} packages`
                : `Core install · ${coreCount} required${conditionalCount > 0 ? ` · ${conditionalCount} conditional` : ""}`
              : `Direct dependencies for the latest release · ${runtimeCount} runtime${peerCount > 0 ? ` · ${peerCount} peer` : ""}`}
          </p>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Resolved install tree (direct + transitive)
          </p>
        )}
        {showChartList || showTransitiveTab ? (
        <div
          role="radiogroup"
          aria-label="Dependencies view"
          className="flex flex-wrap gap-4 border-b border-gray-200 dark:border-gray-600"
        >
          {(
            [
              ...(showChartList
                ? [
                    { id: "chart" as const, label: "Chart" },
                    { id: "list" as const, label: "List" },
                  ]
                : []),
              ...(showTransitiveTab
                ? [{ id: "transitive" as const, label: "Full tree" }]
                : []),
            ] as const
          ).map((option) => {
            const selected = view === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setView(option.id)}
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
        ) : null}
      </div>

      {ecosystem === "pypi" && pypiMeta ? (
        <PypiDependenciesPanel
          packageName={packageName}
          meta={pypiMeta}
          selectedExtra={pypiExtra}
          onSelectExtra={setPypiExtra}
        />
      ) : null}

      {view === "transitive" && features.transitiveDepsTree ? (
        <TransitiveDepsPanel packageName={packageName} ecosystem={ecosystem} />
      ) : showChartList ? (
        <>
          {/* Mobile: list when not chart */}
          <div className="md:hidden">
            {view === "list" ? (
              <DependencyList deps={deps ?? []} ecosystem={ecosystem} />
            ) : (
              <DependenciesGraph
                packageName={packageName}
                dependencies={deps ?? []}
                ecosystem={ecosystem}
              />
            )}
          </div>

          {/* Desktop: chart or list */}
          <div className="hidden md:block">
            {view === "chart" ? (
              <DependenciesGraph
                packageName={packageName}
                dependencies={deps ?? []}
                ecosystem={ecosystem}
              />
            ) : (
              <DependencyList deps={deps ?? []} ecosystem={ecosystem} />
            )}
          </div>
        </>
      ) : ecosystem === "pypi" ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This install option has no dependency packages to list. Choose Default
          install or another optional extra, or see Requires Python above.
        </p>
      ) : null}
    </div>
  );
}
