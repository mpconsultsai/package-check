"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import { buildAllDependencyPathsFromRoot } from "@/lib/utils/dependency-paths";
import {
  packagePagePath,
  type PackageEcosystem,
} from "@/lib/package-routes";

type TransitiveDepNode = {
  name: string;
  version: string;
  relation: "SELF" | "DIRECT" | "INDIRECT" | "OTHER";
  advisoryCount: number;
  advisoryIds: string[];
};

type TransitiveDepEdge = {
  from: string;
  to: string;
  requirement?: string;
};

type GraphPayload = {
  packageName: string;
  version: string;
  nodes: TransitiveDepNode[];
  edges?: TransitiveDepEdge[];
  stats: {
    total: number;
    direct: number;
    indirect: number;
    withAdvisories: number;
  };
  depsDevUrl: string;
  error?: string;
};

type Filter = "all" | "direct" | "transitive" | "advisories";

const PAGE_SIZE = 60;

function nodeKey(n: Pick<TransitiveDepNode, "name" | "version">) {
  return `${n.name}@${n.version}`;
}

function RelationBadge({ relation }: { relation: TransitiveDepNode["relation"] }) {
  const direct = relation === "DIRECT";
  return (
    <span
      className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        direct
          ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
          : "bg-gray-100 text-gray-700 dark:bg-gray-700/70 dark:text-gray-200"
      }`}
    >
      {direct ? "Direct" : "Transitive"}
    </span>
  );
}

function PathBreadcrumb({
  path,
  ecosystem,
}: {
  path: string[];
  ecosystem: PackageEcosystem;
}) {
  if (path.length <= 1) return null;
  return (
    <span className="break-words">
      {path.map((name, i) => (
        <span key={`${name}-${i}`}>
          {i > 0 ? (
            <span className="text-gray-400 dark:text-gray-500"> › </span>
          ) : null}
          {i === path.length - 1 ? (
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {name}
            </span>
          ) : (
            <Link
              href={packagePagePath(ecosystem, name)}
              className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
            >
              {name}
            </Link>
          )}
        </span>
      ))}
    </span>
  );
}

function DepTreeRow({
  node,
  paths,
  ecosystem,
}: {
  node: TransitiveDepNode;
  paths: string[][];
  ecosystem: PackageEcosystem;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPaths = paths.some((p) => p.length > 1);
  const extraCount = paths.length > 1 ? paths.length - 1 : 0;
  const visiblePaths = expanded ? paths : paths.slice(0, 1);

  return (
    <li className="py-2.5 px-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={packagePagePath(ecosystem, node.name)}
              className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400"
            >
              {node.name}
            </Link>
            <RelationBadge relation={node.relation} />
            {node.advisoryCount > 0 && (
              <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-900 dark:bg-red-950/50 dark:text-red-100">
                {node.advisoryCount} advisory
                {node.advisoryCount === 1 ? "" : "ies"}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-mono">{node.version}</span>
          </p>
        </div>
        {hasPaths && extraCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
          >
            {expanded ? "Hide paths" : `+${extraCount} path${extraCount === 1 ? "" : "s"}`}
          </button>
        ) : null}
      </div>
      {hasPaths ? (
        <ul
          className={`mt-1.5 space-y-1 text-xs text-gray-500 dark:text-gray-400 ${
            expanded ? "" : ""
          }`}
        >
          {visiblePaths.map((path, idx) => (
            <li key={pathSignature(path)} className="flex flex-wrap gap-x-1">
              {paths.length > 1 && expanded ? (
                <span className="text-gray-400 dark:text-gray-500 shrink-0">
                  {idx + 1}.
                </span>
              ) : (
                <span className="text-gray-400 dark:text-gray-500 shrink-0">
                  Path:
                </span>
              )}
              <PathBreadcrumb path={path} ecosystem={ecosystem} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function pathSignature(path: string[]): string {
  return path.join("\0");
}

function dedupeListedNodes(nodes: TransitiveDepNode[]): TransitiveDepNode[] {
  const byKey = new Map<string, TransitiveDepNode>();
  for (const node of nodes) {
    const key = nodeKey(node);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, node);
      continue;
    }
    byKey.set(key, {
      ...existing,
      relation:
        existing.relation === "DIRECT" || node.relation === "DIRECT"
          ? "DIRECT"
          : existing.relation === "INDIRECT" || node.relation === "INDIRECT"
            ? "INDIRECT"
            : existing.relation,
      advisoryCount: Math.max(existing.advisoryCount, node.advisoryCount),
      advisoryIds: [...new Set([...existing.advisoryIds, ...node.advisoryIds])],
    });
  }
  return [...byKey.values()];
}

export function TransitiveDepsPanel({
  packageName,
  ecosystem = "npm",
}: {
  packageName: string;
  ecosystem?: PackageEcosystem;
}) {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    setFilter("all");
    setVisibleCount(PAGE_SIZE);

    void fetchJson<GraphPayload>(
      `${apiPaths.packages.dependenciesGraph}?package=${encodeURIComponent(packageName)}`,
      { signal: controller.signal, timeoutMs: 90_000, retries: 1 },
    )
      .then(({ ok, data: payload }) => {
        if (controller.signal.aborted) return;
        if (!ok || payload.error) {
          setError(payload.error || "Could not load dependency tree");
          return;
        }
        setData(payload);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Could not load dependency tree");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [packageName]);

  const pathsByNode = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const edges = data?.edges ?? [];
    const self = nodes.find((n) => n.relation === "SELF");
    if (!self || edges.length === 0) return new Map<string, string[][]>();
    const rootId = nodeKey(self);
    return buildAllDependencyPathsFromRoot(rootId, edges);
  }, [data?.nodes, data?.edges]);

  const listedNodes = useMemo(() => {
    const nodes = dedupeListedNodes(
      (data?.nodes ?? []).filter((n) => n.relation !== "SELF"),
    );
    let filtered = nodes;
    if (filter === "direct") {
      filtered = nodes.filter((n) => n.relation === "DIRECT");
    } else if (filter === "transitive") {
      filtered = nodes.filter((n) => n.relation === "INDIRECT");
    } else if (filter === "advisories") {
      filtered = nodes.filter((n) => n.advisoryCount > 0);
    }
    return [...filtered].sort((a, b) => {
      const rank = (r: TransitiveDepNode["relation"]) =>
        r === "DIRECT" ? 0 : r === "INDIRECT" ? 1 : 2;
      const dr = rank(a.relation) - rank(b.relation);
      if (dr !== 0) return dr;
      if (b.advisoryCount !== a.advisoryCount) {
        return b.advisoryCount - a.advisoryCount;
      }
      return a.name.localeCompare(b.name);
    });
  }, [data?.nodes, filter]);

  const visibleNodes = listedNodes.slice(0, visibleCount);

  if (loading) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400" role="status">
        Loading full dependency tree…
      </p>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!data) return null;

  const filters: { id: Filter; label: string; count: number }[] = [
    {
      id: "all",
      label: "All",
      count: data.stats.direct + data.stats.indirect,
    },
    { id: "direct", label: "Direct", count: data.stats.direct },
    { id: "transitive", label: "Transitive", count: data.stats.indirect },
    {
      id: "advisories",
      label: "With advisories",
      count: data.stats.withAdvisories,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-300 space-y-2">
        <p>
          <strong className="text-gray-900 dark:text-white">Direct</strong>{" "}
          dependencies are declared in this package&apos;s{" "}
          <span className="font-mono text-xs">package.json</span> - what Chart
          and List show from the registry.
        </p>
        <p>
          <strong className="text-gray-900 dark:text-white">Transitive</strong>{" "}
          dependencies are brought in by those packages (and their dependencies)
          when npm resolves the install tree - often most of what actually
          ships. Risks here don&apos;t appear in your top-level manifest. Each
          row shows how it is reached from this package (shortest path first).
          Expand a row when the same resolved version appears on multiple routes.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          This tab uses a resolved tree for{" "}
          <span className="font-mono">
            {data.packageName}@{data.version}
          </span>{" "}
          from{" "}
          <a
            href={data.depsDevUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
          >
            deps.dev
          </a>
          , with advisory counts from OSV.
        </p>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        {data.stats.total} packages in tree · {data.stats.direct} direct ·{" "}
        {data.stats.indirect} transitive
        {data.stats.withAdvisories > 0 && (
          <span className="text-red-700 dark:text-red-300 font-medium">
            {" "}
            · {data.stats.withAdvisories} with advisories
          </span>
        )}
      </p>

      <div
        role="tablist"
        aria-label="Filter dependency tree"
        className="flex flex-wrap gap-2"
      >
        {filters.map((f) => {
          const selected = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setFilter(f.id);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                selected
                  ? "bg-ink text-paper"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {f.label} ({f.count})
            </button>
          );
        })}
      </div>

      {listedNodes.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {filter === "transitive"
            ? "No transitive packages in this resolved tree (unusual for packages with direct deps)."
            : filter === "advisories"
              ? "No advisories on packages in this tree."
              : "No dependencies in this resolved tree."}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 max-h-[28rem] overflow-y-auto">
            {visibleNodes.map((node) => (
              <DepTreeRow
                key={nodeKey(node)}
                node={node}
                paths={pathsByNode.get(nodeKey(node)) ?? []}
                ecosystem={ecosystem}
              />
            ))}
          </ul>
          {listedNodes.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Show more ({listedNodes.length - visibleCount} remaining)
            </button>
          )}
        </>
      )}
    </div>
  );
}
