export type DependencyKind = "runtime" | "peer";

export interface PackageDependency {
  name: string;
  range: string;
  kind: DependencyKind;
  /** PEP 508 environment marker (PyPI conditional requirements). */
  marker?: string;
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
