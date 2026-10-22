import type { PackageEcosystem } from "@/lib/packages/package-routes";

export interface WatchlistAdvisory {
  id: string;
  title: string;
  severity: "low" | "moderate" | "high" | "critical";
}

export interface WatchlistDependencyAdvisory {
  name: string;
  version: string;
  ids: string[];
}

export interface WatchlistSummary {
  version?: string;
  qualityScore?: number;
  vulnerabilityCount?: number;
  advisories?: WatchlistAdvisory[];
  /** npm direct dependencies that had advisories at the last acknowledged check. */
  dependencyAdvisories?: WatchlistDependencyAdvisory[];
  deprecated?: boolean;
  recommendation?: string;
}

/** Latest polled registry snapshot. It can differ from the last acknowledged summary. */
export type WatchlistFresh = Pick<
  WatchlistSummary,
  | "version"
  | "vulnerabilityCount"
  | "advisories"
  | "dependencyAdvisories"
  | "deprecated"
>;

export interface WatchlistAlerts {
  newVersion: boolean;
  newVulns: boolean;
  /** Advisories on this package that were not in the acknowledged summary. */
  newAdvisories: WatchlistAdvisory[];
  newlyDeprecated: boolean;
  /** Direct dependencies whose advisory set grew, or that newly have one. */
  newDependencyAdvisories: WatchlistDependencyAdvisory[];
}

export interface WatchlistEntry {
  name: string;
  ecosystem?: PackageEcosystem;
  pinnedAt: number;
  /** When we last polled the registry for this package. */
  lastCheckedAt?: number;
  /** Snapshot from the last acknowledged review. */
  summary?: WatchlistSummary;
  /** Latest poll result. */
  fresh?: WatchlistFresh;
}

const ADVISORY_CAP = 8;
const DEPENDENCY_CAP = 12;

const SEVERITIES = new Set(["low", "moderate", "high", "critical"]);

export function compactAdvisories(
  advisories: Array<{ id?: string; title?: string; severity?: string }> | null | undefined,
): WatchlistAdvisory[] {
  const compact: WatchlistAdvisory[] = [];
  for (const advisory of advisories ?? []) {
    const id = advisory.id?.trim();
    const title = advisory.title?.trim();
    if (!id || !title) continue;
    const severity = advisory.severity?.toLowerCase();
    compact.push({
      id,
      title,
      severity: SEVERITIES.has(severity ?? "")
        ? (severity as WatchlistAdvisory["severity"])
        : "low",
    });
    if (compact.length >= ADVISORY_CAP) break;
  }
  return compact;
}

export function compactDependencyAdvisories(
  nodes: Array<{ name?: string; version?: string; ids?: string[] }>,
): WatchlistDependencyAdvisory[] {
  return nodes
    .flatMap((node) => {
      const name = node.name?.trim();
      const version = node.version?.trim();
      const ids = (node.ids ?? []).map((id) => id.trim()).filter(Boolean).slice(0, 4);
      if (!name || !version || ids.length === 0) return [];
      return [{ name, version, ids }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, DEPENDENCY_CAP);
}

function idsOf(advisories: WatchlistAdvisory[] | undefined): Set<string> {
  return new Set((advisories ?? []).map((advisory) => advisory.id));
}

export function getWatchlistAlerts(entry: WatchlistEntry): WatchlistAlerts {
  const baseline = entry.summary;
  const fresh = entry.fresh;
  const empty: WatchlistAlerts = {
    newVersion: false,
    newVulns: false,
    newAdvisories: [],
    newlyDeprecated: false,
    newDependencyAdvisories: [],
  };
  if (!baseline || !fresh) return empty;

  const known = idsOf(baseline.advisories);
  const newAdvisories =
    baseline.advisories && fresh.advisories
      ? fresh.advisories.filter((advisory) => !known.has(advisory.id))
      : [];

  const baseVulns = baseline.vulnerabilityCount ?? 0;
  const freshVulns = fresh.vulnerabilityCount ?? 0;
  const countGrew = freshVulns > baseVulns;
  const newVulns = newAdvisories.length > 0 || (countGrew && newAdvisories.length === 0);

  return {
    newVersion: Boolean(
      baseline.version && fresh.version && baseline.version !== fresh.version,
    ),
    newVulns,
    newAdvisories,
    newlyDeprecated: Boolean(fresh.deprecated && !baseline.deprecated),
    newDependencyAdvisories: grownDependencyAdvisories(
      baseline.dependencyAdvisories,
      fresh.dependencyAdvisories,
    ),
  };
}

function grownDependencyAdvisories(
  baseline: WatchlistDependencyAdvisory[] | undefined,
  fresh: WatchlistDependencyAdvisory[] | undefined,
): WatchlistDependencyAdvisory[] {
  if (!baseline || !fresh) return [];
  const previous = new Map(
    baseline.map((dep) => [dep.name.toLowerCase(), new Set(dep.ids)]),
  );
  const grown: WatchlistDependencyAdvisory[] = [];
  for (const dep of fresh) {
    const seen = previous.get(dep.name.toLowerCase());
    if (!seen) {
      grown.push(dep);
      continue;
    }
    const added = dep.ids.filter((id) => !seen.has(id));
    if (added.length > 0) grown.push({ ...dep, ids: added });
  }
  return grown;
}

export function watchlistEntryHasAlerts(entry: WatchlistEntry): boolean {
  const alerts = getWatchlistAlerts(entry);
  return (
    alerts.newVersion ||
    alerts.newVulns ||
    alerts.newlyDeprecated ||
    alerts.newDependencyAdvisories.length > 0
  );
}

export function summarizeWatchlistAlerts(entries: WatchlistEntry[]): {
  total: number;
  newVulns: number;
  newVersion: number;
  newlyDeprecated: number;
  /** Prefer security over a version bump over a deprecation. */
  tone: "none" | "vulns" | "version" | "deprecated";
} {
  let newVulns = 0;
  let newVersion = 0;
  let newlyDeprecated = 0;

  for (const entry of entries) {
    const alerts = getWatchlistAlerts(entry);
    if (alerts.newVulns || alerts.newDependencyAdvisories.length > 0) newVulns += 1;
    if (alerts.newVersion) newVersion += 1;
    if (alerts.newlyDeprecated) newlyDeprecated += 1;
  }

  const total = entries.filter(watchlistEntryHasAlerts).length;
  const tone =
    newVulns > 0
      ? "vulns"
      : newVersion > 0
        ? "version"
        : newlyDeprecated > 0
          ? "deprecated"
          : "none";

  return { total, newVulns, newVersion, newlyDeprecated, tone };
}

function alertSnapshot(fresh: WatchlistFresh): WatchlistFresh {
  return {
    version: fresh.version,
    vulnerabilityCount: fresh.vulnerabilityCount,
    advisories: fresh.advisories,
    dependencyAdvisories: fresh.dependencyAdvisories,
    deprecated: fresh.deprecated,
  };
}

/**
 * Record a poll. The first time advisories or direct-dependency advisories are
 * measured, matching counts are stored on the summary so they are not announced
 * as new. A higher advisory count still stays a notice.
 */
export function watchlistAfterPoll(
  entry: WatchlistEntry,
  fresh: WatchlistFresh,
  checkedAt: number,
): WatchlistEntry {
  const snapshot = alertSnapshot(fresh);
  if (!entry.summary) {
    return {
      ...entry,
      lastCheckedAt: checkedAt,
      summary: {
        version: snapshot.version,
        vulnerabilityCount: snapshot.vulnerabilityCount,
        advisories: snapshot.advisories,
        dependencyAdvisories: snapshot.dependencyAdvisories,
        deprecated: snapshot.deprecated,
      },
      fresh: snapshot,
    };
  }

  let summary = entry.summary;
  const sameCount =
    (summary.vulnerabilityCount ?? 0) === (snapshot.vulnerabilityCount ?? 0);
  if (summary.advisories === undefined && snapshot.advisories && sameCount) {
    summary = { ...summary, advisories: snapshot.advisories };
  }
  if (
    summary.dependencyAdvisories === undefined &&
    snapshot.dependencyAdvisories
  ) {
    summary = {
      ...summary,
      dependencyAdvisories: snapshot.dependencyAdvisories,
    };
  }

  return {
    ...entry,
    lastCheckedAt: checkedAt,
    summary,
    fresh: snapshot,
  };
}

/** A page view updates the baseline only when nothing is waiting to be read. */
export function watchlistAfterVisit(
  entry: WatchlistEntry,
  summary: WatchlistSummary,
  visitedAt: number,
): WatchlistEntry {
  if (watchlistEntryHasAlerts(entry)) {
    return {
      ...entry,
      summary: {
        ...entry.summary,
        qualityScore: summary.qualityScore,
        recommendation: summary.recommendation,
        dependencyAdvisories:
          summary.dependencyAdvisories ?? entry.summary?.dependencyAdvisories,
      },
    };
  }

  const fresh = alertSnapshot({
    ...summary,
    dependencyAdvisories:
      summary.dependencyAdvisories ?? entry.fresh?.dependencyAdvisories,
  });
  return {
    ...entry,
    lastCheckedAt: visitedAt,
    summary: {
      ...summary,
      advisories: summary.advisories ?? entry.summary?.advisories,
      dependencyAdvisories:
        summary.dependencyAdvisories ?? entry.summary?.dependencyAdvisories,
    },
    fresh: {
      ...fresh,
      advisories: fresh.advisories ?? entry.fresh?.advisories,
      dependencyAdvisories:
        fresh.dependencyAdvisories ?? entry.fresh?.dependencyAdvisories,
    },
  };
}

/** Copy the latest poll onto the acknowledged summary. */
export function watchlistAfterAcknowledge(
  entry: WatchlistEntry,
): WatchlistEntry {
  if (!entry.fresh) return entry;
  return {
    ...entry,
    summary: {
      ...entry.summary,
      version: entry.fresh.version,
      vulnerabilityCount: entry.fresh.vulnerabilityCount,
      deprecated: entry.fresh.deprecated,
      advisories: entry.fresh.advisories ?? entry.summary?.advisories,
      dependencyAdvisories:
        entry.fresh.dependencyAdvisories ?? entry.summary?.dependencyAdvisories,
    },
    fresh: entry.fresh,
  };
}
