import semver from "semver";
import type { PeerChange } from "@/lib/upgrade/upgrade-release-notes";

export interface VersionManifest {
  deprecated: string | null;
  moduleType: string | null;
  engines: Record<string, string>;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

export interface ManifestComparison {
  deprecation: { from: string | null; to: string | null };
  /** Set when package.json `type` differs. */
  moduleType: { from: string | null; to: string | null } | null;
  engines: PeerChange[];
  dependencies: PeerChange[];
}

function rangeMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const ranges: Record<string, string> = {};
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof range === "string" && range.trim()) ranges[name] = range.trim();
  }
  return ranges;
}

/** Fields from one npm version document that matter when upgrading. */
export function manifestFromVersionDoc(data: unknown): VersionManifest | null {
  if (!data || typeof data !== "object") return null;
  const doc = data as Record<string, unknown>;
  const deprecated =
    typeof doc.deprecated === "string" && doc.deprecated.trim()
      ? doc.deprecated.trim()
      : null;
  const moduleType =
    doc.type === "module" || doc.type === "commonjs" ? doc.type : null;
  return {
    deprecated,
    moduleType,
    engines: rangeMap(doc.engines),
    dependencies: rangeMap(doc.dependencies),
    peerDependencies: rangeMap(doc.peerDependencies),
  };
}

export function diffNamedRanges(
  fromRanges?: Record<string, string> | null,
  toRanges?: Record<string, string> | null,
): PeerChange[] {
  const left = fromRanges ?? {};
  const right = toRanges ?? {};
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes: PeerChange[] = [];
  for (const name of [...names].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )) {
    const from = left[name];
    const to = right[name];
    if (from && !to) changes.push({ kind: "removed", name, range: from });
    else if (!from && to) changes.push({ kind: "added", name, range: to });
    else if (from && to && from !== to) {
      changes.push({ kind: "changed", name, from, to });
    }
  }
  return changes;
}

export function compareManifests(
  from: VersionManifest,
  to: VersionManifest,
): ManifestComparison {
  const moduleChanged = from.moduleType !== to.moduleType;
  return {
    deprecation: { from: from.deprecated, to: to.deprecated },
    moduleType: moduleChanged
      ? { from: from.moduleType, to: to.moduleType }
      : null,
    engines: diffNamedRanges(from.engines, to.engines),
    dependencies: diffNamedRanges(from.dependencies, to.dependencies),
  };
}

/**
 * True when `version` is inside the advisory's vulnerable range.
 * Null when the range cannot be read.
 */
export function advisoryStillAffects(
  version: string,
  vulnerableVersionRange: string | null | undefined,
): boolean | null {
  const range = vulnerableVersionRange?.trim();
  const clean = semver.valid(version) ?? semver.clean(version);
  if (!range || !clean) return null;
  try {
    return semver.satisfies(clean, range, { includePrerelease: true });
  } catch {
    return null;
  }
}
