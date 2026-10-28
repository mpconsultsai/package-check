/** Numeric Maven version parts before a qualifier. */
function versionParts(version: string): number[] {
  const core = version.trim().split(/[-+]/)[0] ?? "";
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

/** Qualifier after the numeric core (e.g. jre, Final, SNAPSHOT). */
function qualifier(version: string): string {
  const match = version.trim().match(/^[\d.]+(?:[-+](.+))?$/);
  return (match?.[1] ?? "").toLowerCase();
}

const QUALIFIER_RANK: Record<string, number> = {
  alpha: 10,
  beta: 20,
  milestone: 30,
  m: 30,
  rc: 40,
  cr: 40,
  snapshot: 50,
  "": 100,
  ga: 110,
  final: 110,
  release: 110,
  sp: 120,
};

/**
 * Platform lines (Guava etc.) share a numeric version but ship as -jre / -android.
 * Prefer the JVM line when the numbers match.
 */
const PLATFORM_PREF: Record<string, number> = {
  jre: 3,
  "": 2,
  android: 1,
};

function qualifierRank(raw: string): number {
  if (!raw) return QUALIFIER_RANK[""];
  const family = qualifierFamily(raw);
  if (family in QUALIFIER_RANK) return QUALIFIER_RANK[family];
  if (family === "jre" || family === "android") return 105;
  return 90;
}

function platformPref(raw: string): number {
  const family = qualifierFamily(raw);
  if (family in PLATFORM_PREF) return PLATFORM_PREF[family];
  return 0;
}

function qualifierFamily(raw: string): string {
  const head = (raw.split(/[.\-_]/)[0] ?? raw).toLowerCase();
  const match = head.match(
    /^(alpha|beta|milestone|m|rc|cr|snapshot|ga|final|release|sp|jre|android)/,
  );
  return match?.[1] ?? head;
}

export function isMavenPrerelease(version: string): boolean {
  const q = qualifier(version);
  if (!q) return false;
  return ["alpha", "beta", "milestone", "m", "rc", "cr", "snapshot"].includes(
    qualifierFamily(q),
  );
}

/** Compare Maven versions. Stable releases sort above prereleases of the same numbers. */
export function compareMavenVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const leftQ = qualifier(a);
  const rightQ = qualifier(b);
  const rankDiff = qualifierRank(leftQ) - qualifierRank(rightQ);
  if (rankDiff !== 0) return rankDiff;
  const platformDiff = platformPref(leftQ) - platformPref(rightQ);
  if (platformDiff !== 0) return platformDiff;
  return leftQ.localeCompare(rightQ);
}

export function listStableMavenVersions(
  time?: Record<string, string> | null,
): string[] {
  if (!time) return [];
  return Object.keys(time)
    .filter((key) => !["created", "modified", "unpublished"].includes(key))
    .filter((version) => !isMavenPrerelease(version))
    .sort((a, b) => compareMavenVersions(b, a));
}

/** True when a pinned Maven version is older than the latest release. */
export function isMavenUpdateAvailable(
  requested: string | undefined,
  latest: string | undefined,
): boolean {
  if (!requested || !latest || latest === "Unknown") return false;
  const spec = requested.trim();
  if (!spec || spec === "*") return false;
  const match = spec.match(
    /(\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?)/,
  );
  if (!match) return false;
  return compareMavenVersions(latest, match[1]) > 0;
}
