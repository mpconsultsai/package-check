import semver from "semver";
import { parseNodeRuntimeVersion } from "@/lib/prefs/node-runtime-pref";
import type { ReversePeerFit } from "@/lib/upgrade/project-reverse-peer-fit";

export type ProjectPeerFitStatus = "satisfies" | "missing" | "conflicts";

export type ProjectPeerFit = {
  name: string;
  required: string;
  project: string | null;
  status: ProjectPeerFitStatus;
};

export type { ReversePeerFit };

export type ProjectEnginesFit = {
  target: string | null;
  project: string | null;
  runtime: string | null;
  /** Whether project engines.node intersects / satisfies the target requirement. */
  projectSatisfiesTarget: boolean | null;
  /** Whether the user's Node Version field satisfies the target engines.node. */
  runtimeSatisfiesTarget: boolean | null;
};

export type ProjectUpgradeFit = {
  peers: ProjectPeerFit[];
  engines: ProjectEnginesFit;
  conflictCount: number;
  missingCount: number;
};

/** Compact facts payload for the upgrade agent. */
export type ProjectUpgradeFacts = {
  hasContext: boolean;
  fingerprint: string;
  packageRequested: string | null;
  peerFits: ProjectPeerFit[];
  /** Other project packages whose peers reject the upgrade target. */
  reversePeerFits: ReversePeerFit[];
  enginesNode: string | null;
  enginesConflict: boolean;
  conflictCount: number;
  missingCount: number;
};

/**
 * Resolve a project range/version to a concrete stable version from the list.
 * Prefers the lowest satisfying release so "current" is conservative.
 */
export function resolveProjectPackageVersion(
  requested: string | undefined | null,
  versions: string[],
): string | null {
  if (!requested?.trim() || versions.length === 0) return null;
  const cleaned = requested.trim();
  const exact = semver.valid(cleaned);
  if (exact) {
    return versions.includes(exact) ? exact : null;
  }

  try {
    const min = semver.minSatisfying(versions, cleaned, {
      includePrerelease: false,
    });
    if (min) return min;
  } catch {
    // invalid range
  }

  const coerced = semver.coerce(cleaned)?.version;
  if (coerced && versions.includes(coerced)) return coerced;

  try {
    const max = semver.maxSatisfying(versions, cleaned, {
      includePrerelease: false,
    });
    if (max) return max;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Derive a seedable Node Version from project engines.node when the user
 * has no saved runtime preference.
 */
export function seedNodeVersionFromEngines(
  enginesNode: string | null | undefined,
): string | null {
  if (!enginesNode?.trim()) return null;
  const trimmed = enginesNode.trim();
  try {
    const min = semver.minVersion(trimmed);
    if (min) {
      const parsed = parseNodeRuntimeVersion(min.version);
      if (parsed.ok && parsed.value) return parsed.value;
    }
  } catch {
    // not a parseable range
  }
  const coerced = semver.coerce(trimmed);
  if (!coerced) return null;
  const parsed = parseNodeRuntimeVersion(coerced.version);
  return parsed.ok && parsed.value ? parsed.value : null;
}

function projectSatisfiesRequired(
  project: string,
  required: string,
): boolean | null {
  const clean =
    semver.valid(project) ?? semver.coerce(project)?.version ?? null;
  if (clean) {
    try {
      return semver.satisfies(clean, required, { includePrerelease: true });
    } catch {
      return null;
    }
  }
  try {
    return semver.intersects(project, required, { includePrerelease: true });
  } catch {
    return null;
  }
}

/**
 * Project engines.node must not allow runtimes outside the target requirement.
 * Prefer subset (project ⊆ target); fall back to the project's minimum version.
 */
function engineRangesCompatible(
  projectOrRuntime: string,
  target: string,
): boolean | null {
  const clean =
    semver.valid(projectOrRuntime) ??
    semver.coerce(projectOrRuntime)?.version ??
    null;
  if (clean) {
    try {
      return semver.satisfies(clean, target, { includePrerelease: true });
    } catch {
      return null;
    }
  }
  try {
    if (semver.subset(projectOrRuntime, target, { includePrerelease: true })) {
      return true;
    }
  } catch {
    // ignore invalid range
  }
  try {
    const min = semver.minVersion(projectOrRuntime);
    if (min) {
      return semver.satisfies(min.version, target, { includePrerelease: true });
    }
  } catch {
    // ignore
  }
  try {
    return semver.intersects(projectOrRuntime, target, {
      includePrerelease: true,
    });
  } catch {
    return null;
  }
}

/**
 * Compare target peerDependencies + engines against the project's declared
 * dependency map and engines.node (declared manifests only).
 */
export function computeProjectUpgradeFit(input: {
  projectDeps: Record<string, string>;
  projectEnginesNode: string | null;
  runtimeNode: string | null;
  targetPeers: Record<string, string>;
  targetEngines: Record<string, string> | null;
}): ProjectUpgradeFit {
  const peers: ProjectPeerFit[] = [];
  for (const [name, required] of Object.entries(input.targetPeers)) {
    if (!required?.trim()) continue;
    const project = input.projectDeps[name] ?? null;
    let status: ProjectPeerFitStatus;
    if (!project) {
      status = "missing";
    } else {
      const ok = projectSatisfiesRequired(project, required.trim());
      status = ok === false ? "conflicts" : "satisfies";
    }
    peers.push({
      name,
      required: required.trim(),
      project,
      status,
    });
  }

  peers.sort((a, b) => {
    const rank = (s: ProjectPeerFitStatus) =>
      s === "conflicts" ? 0 : s === "missing" ? 1 : 2;
    const diff = rank(a.status) - rank(b.status);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  const targetNode = input.targetEngines?.node?.trim() || null;
  const projectNode = input.projectEnginesNode?.trim() || null;
  const runtime = input.runtimeNode?.trim() || null;

  let projectSatisfiesTarget: boolean | null = null;
  let runtimeSatisfiesTarget: boolean | null = null;
  if (targetNode && projectNode) {
    projectSatisfiesTarget = engineRangesCompatible(projectNode, targetNode);
  }
  if (targetNode && runtime) {
    runtimeSatisfiesTarget = engineRangesCompatible(runtime, targetNode);
  }

  const conflictCount =
    peers.filter((p) => p.status === "conflicts").length +
    (projectSatisfiesTarget === false ? 1 : 0);
  const missingCount = peers.filter((p) => p.status === "missing").length;

  return {
    peers,
    engines: {
      target: targetNode,
      project: projectNode,
      runtime,
      projectSatisfiesTarget,
      runtimeSatisfiesTarget,
    },
    conflictCount,
    missingCount,
  };
}

export function buildProjectUpgradeFacts(input: {
  hasContext: boolean;
  fingerprint?: string;
  packageRequested?: string | null;
  fit?: ProjectUpgradeFit | null;
  reversePeers?: ReversePeerFit[] | null;
  enginesNode?: string | null;
}): ProjectUpgradeFacts {
  const fit = input.fit;
  const peerFits = (fit?.peers ?? []).filter(
    (p) => p.status === "conflicts" || p.status === "missing",
  );
  const reversePeerFits = (input.reversePeers ?? []).filter(
    (p) => p.status === "conflicts",
  );
  const reverseConflicts = reversePeerFits.length;
  return {
    hasContext: input.hasContext,
    fingerprint: input.fingerprint ?? "",
    packageRequested: input.packageRequested ?? null,
    peerFits,
    reversePeerFits,
    enginesNode: input.enginesNode ?? fit?.engines.project ?? null,
    enginesConflict: fit?.engines.projectSatisfiesTarget === false,
    conflictCount: (fit?.conflictCount ?? 0) + reverseConflicts,
    missingCount: fit?.missingCount ?? 0,
  };
}
