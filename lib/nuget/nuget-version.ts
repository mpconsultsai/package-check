/** Numeric NuGet version parts, ignoring a prerelease or build label. */
function versionParts(version: string): number[] {
  const core = version.trim().split("+")[0]?.split("-")[0] ?? "";
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

export function isNugetPrerelease(version: string): boolean {
  return version.includes("-");
}

/** Compare NuGet versions. Stable releases sort above prereleases of the same numbers. */
export function compareNugetVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const leftPre = isNugetPrerelease(a);
  const rightPre = isNugetPrerelease(b);
  if (leftPre !== rightPre) return leftPre ? -1 : 1;
  return a.localeCompare(b);
}

export function listStableNugetVersions(
  time?: Record<string, string> | null,
): string[] {
  if (!time) return [];
  return Object.keys(time)
    .filter((key) => !["created", "modified", "unpublished"].includes(key))
    .filter((version) => !isNugetPrerelease(version))
    .sort((a, b) => compareNugetVersions(b, a));
}

/** True when a pinned NuGet version or range is older than the latest release. */
export function isNugetUpdateAvailable(
  requested: string | undefined,
  latest: string | undefined,
): boolean {
  if (!requested || !latest || latest === "Unknown") return false;
  const spec = requested.trim();
  if (!spec || spec === "*") return false;
  const match = spec.match(/(\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?)/);
  if (!match) return false;
  return compareNugetVersions(latest, match[1]) > 0;
}
