export type DependencyKind = "runtime" | "peer";

export interface PackageDependency {
  name: string;
  range: string;
  kind: DependencyKind;
  /** PEP 508 environment marker (PyPI conditional requirements). */
  marker?: string;
  /** Version deps.dev resolved for an npm direct dependency. */
  resolvedVersion?: string;
  /** Known advisories on that resolved version. npm only. */
  advisoryCount?: number;
  advisoryIds?: string[];
}

type DirectAdvisoryNode = {
  name: string;
  version: string;
  relation: string;
  advisoryCount: number;
  advisoryIds: string[];
};

/** Copy advisory counts from a deps.dev graph onto matching direct dependencies. */
export function attachDirectAdvisories(
  dependencies: PackageDependency[],
  nodes: DirectAdvisoryNode[],
): PackageDependency[] {
  const direct = new Map<string, DirectAdvisoryNode>();
  for (const node of nodes) {
    if (node.relation !== "DIRECT" || node.advisoryCount <= 0) continue;
    const key = node.name.toLowerCase();
    const existing = direct.get(key);
    if (!existing || node.advisoryCount > existing.advisoryCount) {
      direct.set(key, node);
    }
  }

  return dependencies.map((dep) => {
    const node = direct.get(dep.name.toLowerCase());
    if (!node) return dep;
    return {
      ...dep,
      resolvedVersion: node.version,
      advisoryCount: node.advisoryCount,
      advisoryIds: node.advisoryIds.slice(0, 4),
    };
  });
}

export function formatDirectAdvisoryLine(node: {
  name: string;
  version: string;
  advisoryCount: number;
  advisoryIds: string[];
}): string {
  const ids = node.advisoryIds.slice(0, 3).filter(Boolean);
  if (ids.length > 0) {
    return `${node.name}@${node.version} has advisories: ${ids.join(", ")}`;
  }
  const noun = node.advisoryCount === 1 ? "advisory" : "advisories";
  return `${node.name}@${node.version} has ${node.advisoryCount} ${noun}`;
}

/** Stable list keys when the same package appears more than once (e.g. PyPI markers). */
export function dependencyReactKey(
  dep: PackageDependency,
  index: number,
): string {
  const markerPart = dep.marker
    ? dep.marker.replace(/\s+/g, " ").slice(0, 120)
    : "";
  return `${dep.kind}:${dep.name}:${dep.range}:${markerPart}:${index}`;
}

const asDeps = (
  record: Record<string, string> | null | undefined,
  kind: DependencyKind,
): PackageDependency[] => {
  if (!record) return [];
  return Object.entries(record)
    .filter(
      ([name, range]) =>
        typeof name === "string" &&
        name.trim() &&
        typeof range === "string" &&
        range.trim(),
    )
    .map(([name, range]) => ({
      name: name.trim(),
      range: range.trim(),
      kind,
    }));
};

/** Direct runtime + peer dependencies for a package version. */
export const listPackageDependencies = (
  dependencies?: Record<string, string> | null,
  peerDependencies?: Record<string, string> | null,
): PackageDependency[] => {
  const runtime = asDeps(dependencies, "runtime").sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const peers = asDeps(peerDependencies, "peer").sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  // Prefer runtime if the same name appears in both.
  const seen = new Set(runtime.map((d) => d.name.toLowerCase()));
  return [
    ...runtime,
    ...peers.filter((d) => !seen.has(d.name.toLowerCase())),
  ];
};
