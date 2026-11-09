import axios from "axios";
import semver from "semver";
import { mapPool } from "@/lib/data-fetchers/watchlist-status";
import { resolveProjectPackageVersion } from "@/lib/upgrade/project-upgrade-fit";

const NPM_REGISTRY_URL = "https://registry.npmjs.org";

/** Cap registry lookups so paste-heavy projects stay responsive. */
export const REVERSE_PEER_SCAN_MAX = 48;
const REVERSE_PEER_CONCURRENCY = 6;

export type ReversePeerFitStatus = "satisfies" | "conflicts";

/** Another project package that peer-depends on the package being upgraded. */
export type ReversePeerFit = {
  /** Consumer package in the project (e.g. @typescript-eslint/parser). */
  name: string;
  /** Concrete consumer version we inspected. */
  at: string;
  /** Consumer's peerDependencies range for the upgrade package. */
  required: string;
  /** Upgrade target version being checked. */
  target: string;
  status: ReversePeerFitStatus;
};

export function targetSatisfiesPeerRange(
  targetVersion: string,
  peerRange: string,
): boolean | null {
  const clean =
    semver.valid(targetVersion) ??
    semver.coerce(targetVersion)?.version ??
    null;
  if (!clean || !peerRange.trim()) return null;
  try {
    return semver.satisfies(clean, peerRange.trim(), {
      includePrerelease: true,
    });
  } catch {
    return null;
  }
}

export function evaluateReversePeerFit(input: {
  consumerName: string;
  consumerVersion: string;
  peerRange: string;
  targetVersion: string;
}): ReversePeerFit {
  const ok = targetSatisfiesPeerRange(input.targetVersion, input.peerRange);
  return {
    name: input.consumerName,
    at: input.consumerVersion,
    required: input.peerRange.trim(),
    target: input.targetVersion,
    status: ok === false ? "conflicts" : "satisfies",
  };
}

function encodeNpmName(packageName: string): string {
  return packageName.startsWith("@")
    ? packageName.replace("/", "%2F")
    : packageName;
}

type AbbreviatedPackument = {
  versions?: Record<
    string,
    { peerDependencies?: Record<string, string> }
  >;
};

async function inspectConsumerPeer(input: {
  consumerName: string;
  requested: string;
  upgradePackage: string;
  targetVersion: string;
  signal?: AbortSignal;
}): Promise<ReversePeerFit | null> {
  try {
    const { data } = await axios.get<AbbreviatedPackument>(
      `${NPM_REGISTRY_URL}/${encodeNpmName(input.consumerName)}`,
      {
        timeout: 10_000,
        signal: input.signal,
        headers: { Accept: "application/vnd.npm.install-v1+json" },
      },
    );
    const versionDocs = data.versions ?? {};
    const versions = Object.keys(versionDocs).filter((version) => {
      const clean = semver.valid(version);
      return Boolean(clean && !semver.prerelease(clean));
    });
    const resolved = resolveProjectPackageVersion(input.requested, versions);
    if (!resolved) return null;
    const peerRange = versionDocs[resolved]?.peerDependencies?.[
      input.upgradePackage
    ];
    if (typeof peerRange !== "string" || !peerRange.trim()) return null;
    return evaluateReversePeerFit({
      consumerName: input.consumerName,
      consumerVersion: resolved,
      peerRange,
      targetVersion: input.targetVersion,
    });
  } catch {
    return null;
  }
}

/**
 * Scan project packages for peerDependencies on `upgradePackage` and check
 * whether `targetVersion` satisfies those peers (typescript-style reverse fit).
 */
export async function loadReversePeerFits(input: {
  upgradePackage: string;
  targetVersion: string;
  projectDeps: Record<string, string>;
  signal?: AbortSignal;
}): Promise<{
  fits: ReversePeerFit[];
  scanned: number;
  truncated: boolean;
}> {
  const upgradeKey = input.upgradePackage.trim().toLowerCase();
  const entries = Object.entries(input.projectDeps)
    .filter(([name]) => name.trim().toLowerCase() !== upgradeKey)
    .sort(([a], [b]) => a.localeCompare(b));

  const truncated = entries.length > REVERSE_PEER_SCAN_MAX;
  const slice = entries.slice(0, REVERSE_PEER_SCAN_MAX);

  const results = await mapPool(
    slice,
    REVERSE_PEER_CONCURRENCY,
    async ([name, requested]) =>
      inspectConsumerPeer({
        consumerName: name,
        requested,
        upgradePackage: input.upgradePackage,
        targetVersion: input.targetVersion,
        signal: input.signal,
      }),
  );

  const fits = results
    .filter((row): row is ReversePeerFit => Boolean(row))
    .sort((a, b) => {
      const rank = (s: ReversePeerFitStatus) => (s === "conflicts" ? 0 : 1);
      const diff = rank(a.status) - rank(b.status);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });

  return { fits, scanned: slice.length, truncated };
}
