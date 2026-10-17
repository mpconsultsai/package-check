"use client";

import type { PackageDependency } from "@/lib/package-deps";

export type PypiDependenciesMeta = {
  requiresPython: string | null;
  providesExtra: string[];
  core: PackageDependency[];
  conditional: Array<PackageDependency & { marker: string }>;
  extras: Record<string, PackageDependency[]>;
};

function normalizePypiMeta(
  raw: Partial<PypiDependenciesMeta> & {
    core?: PackageDependency[];
  },
  fallbackCore: PackageDependency[] = [],
): PypiDependenciesMeta {
  return {
    requiresPython: raw.requiresPython ?? null,
    providesExtra: Array.isArray(raw.providesExtra) ? raw.providesExtra : [],
    core: Array.isArray(raw.core) ? raw.core : fallbackCore,
    conditional: Array.isArray(raw.conditional) ? raw.conditional : [],
    extras: raw.extras && typeof raw.extras === "object" ? raw.extras : {},
  };
}

export function combinePypiDepsForView(
  meta: PypiDependenciesMeta,
  selectedExtra: string | null,
): PackageDependency[] {
  const core = meta.core ?? [];
  const conditional = meta.conditional ?? [];
  const combined: PackageDependency[] = [...core, ...conditional];
  if (selectedExtra && meta.extras?.[selectedExtra]) {
    for (const dep of meta.extras[selectedExtra]!) {
      combined.push(dep);
    }
  }
  return combined;
}

export function pypiHasAnyRequirements(meta: PypiDependenciesMeta): boolean {
  if ((meta.core?.length ?? 0) > 0 || (meta.conditional?.length ?? 0) > 0) {
    return true;
  }
  return Object.values(meta.extras ?? {}).some((list) => list.length > 0);
}

export { normalizePypiMeta };

export function PypiDependenciesPanel({
  packageName,
  meta,
  selectedExtra,
  onSelectExtra,
}: {
  packageName: string;
  meta: PypiDependenciesMeta;
  selectedExtra: string | null;
  onSelectExtra: (extra: string | null) => void;
}) {
  const extrasWithDeps = meta.providesExtra.filter(
    (name) => (meta.extras[name]?.length ?? 0) > 0,
  );
  const showExtraPicker =
    meta.providesExtra.length > 0 || extrasWithDeps.length > 0;

  return (
    <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40 sm:p-4">
      {meta.requiresPython ? (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-medium text-gray-900 dark:text-white">
            Requires Python:
          </span>{" "}
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">
            {meta.requiresPython}
          </code>
        </p>
      ) : null}

      {showExtraPicker ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Optional extras
          </p>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-label="Install extra"
          >
            <button
              type="button"
              onClick={() => onSelectExtra(null)}
              className={`rounded-sm px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                selectedExtra === null
                  ? "bg-ink text-paper"
                  : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              }`}
            >
              Default install
            </button>
            {meta.providesExtra.map((extra) => (
              <button
                key={extra}
                type="button"
                onClick={() => onSelectExtra(extra)}
                className={`rounded-sm px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                  selectedExtra === extra
                    ? "bg-ink text-paper"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                }`}
              >
                {extra}
                {(meta.extras[extra]?.length ?? 0) > 0
                  ? ` (+${meta.extras[extra]!.length})`
                  : ""}
              </button>
            ))}
          </div>
          {selectedExtra ? (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Install with:{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono dark:bg-gray-800">
                pip install {packageName}[{selectedExtra}]
              </code>
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Core requirements below; pick an extra to see additional packages.
            </p>
          )}
        </div>
      ) : null}

      {meta.conditional.length > 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {meta.conditional.length} conditional requirement
          {meta.conditional.length === 1 ? "" : "s"} (environment-specific) included
          in the list with markers.
        </p>
      ) : null}
    </div>
  );
}
