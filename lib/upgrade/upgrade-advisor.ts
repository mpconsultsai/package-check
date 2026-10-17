import semver from "semver";

const TIME_META = new Set(["created", "modified", "unpublished"]);

export type UpgradeBumpKind = "major" | "minor" | "patch" | "same" | "unknown";

export type UpgradeVerdict =
  | "current"
  | "patch"
  | "minor"
  | "major"
  | "invalid";

export interface UpgradeAdvice {
  from: string;
  to: string;
  fromClean: string | null;
  toClean: string | null;
  bump: UpgradeBumpKind;
  verdict: UpgradeVerdict;
  headline: string;
  summary: string;
  releasesBehind: number;
  majorsCrossed: number;
  fromPublishedAt: string | null;
  toPublishedAt: string | null;
  daysBetween: number | null;
  intermediateMajors: string[];
}

export function listStableVersions(
  versionTimes?: Record<string, string> | null,
): string[] {
  if (!versionTimes) return [];
  return Object.keys(versionTimes)
    .filter((key) => !TIME_META.has(key))
    .filter((v) => Boolean(semver.valid(v)) && !semver.prerelease(v))
    .sort((a, b) => semver.rcompare(a, b));
}

function bumpKind(from: string, to: string): UpgradeBumpKind {
  if (semver.eq(from, to)) return "same";
  const diff = semver.diff(from, to);
  if (!diff) return "unknown";
  if (diff === "major" || diff === "premajor") return "major";
  if (diff === "minor" || diff === "preminor") return "minor";
  if (
    diff === "patch" ||
    diff === "prepatch" ||
    diff === "prerelease"
  ) {
    return "patch";
  }
  return "unknown";
}

function daysBetweenIso(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

/** Highest release per major strictly between from and to (exclusive). */
function majorsCrossedBetween(
  from: string,
  to: string,
  allVersions: string[],
): string[] {
  const fromMajor = semver.major(from);
  const toMajor = semver.major(to);
  if (toMajor <= fromMajor + 1) return [];

  const seen = new Set<number>();
  const lines: string[] = [];
  for (const v of allVersions) {
    const cleaned = semver.valid(v);
    if (!cleaned) continue;
    if (!semver.gt(cleaned, from) || !semver.lt(cleaned, to)) continue;
    const major = semver.major(cleaned);
    if (major <= fromMajor || major >= toMajor) continue;
    if (seen.has(major)) continue;
    seen.add(major);
    // Prefer the highest release of that major line (list is newest-first)
    const best = allVersions.find(
      (x) => semver.valid(x) && semver.major(x!) === major,
    );
    if (best) lines.push(best);
  }
  return lines.sort((a, b) => semver.compare(a, b));
}

export function buildUpgradeAdvice(input: {
  from: string;
  to: string;
  versionTimes?: Record<string, string> | null;
  versions?: string[];
}): UpgradeAdvice {
  const fromRaw = input.from.trim();
  const toRaw = input.to.trim();
  const fromClean = semver.clean(fromRaw) ?? (semver.valid(fromRaw) ? fromRaw : null);
  const toClean = semver.clean(toRaw) ?? (semver.valid(toRaw) ? toRaw : null);
  const versions =
    input.versions ?? listStableVersions(input.versionTimes);

  const fromPublishedAt =
    input.versionTimes && fromRaw ? input.versionTimes[fromRaw] ?? null : null;
  const toPublishedAt =
    input.versionTimes && toRaw ? input.versionTimes[toRaw] ?? null : null;

  if (!fromClean || !toClean) {
    return {
      from: fromRaw,
      to: toRaw,
      fromClean,
      toClean,
      bump: "unknown",
      verdict: "invalid",
      headline: "Enter a valid version",
      summary: "Use a published semver version to compare against the latest release.",
      releasesBehind: 0,
      majorsCrossed: 0,
      fromPublishedAt,
      toPublishedAt,
      daysBetween: daysBetweenIso(fromPublishedAt, toPublishedAt),
      intermediateMajors: [],
    };
  }

  const bump = bumpKind(fromClean, toClean);
  const releasesBehind = versions.filter((v) => {
    const cleaned = semver.valid(v);
    return cleaned && semver.gt(cleaned, fromClean) && semver.lte(cleaned, toClean);
  }).length;

  const intermediateMajors = majorsCrossedBetween(fromClean, toClean, versions);
  const majorsCrossed =
    bump === "major" ? Math.max(1, semver.major(toClean) - semver.major(fromClean)) : 0;

  if (bump === "same") {
    return {
      from: fromRaw,
      to: toRaw,
      fromClean,
      toClean,
      bump,
      verdict: "current",
      headline: "Already on the latest release",
      summary:
        "No upgrade needed - this matches the latest stable version on npm.",
      releasesBehind: 0,
      majorsCrossed: 0,
      fromPublishedAt,
      toPublishedAt,
      daysBetween: daysBetweenIso(fromPublishedAt, toPublishedAt),
      intermediateMajors: [],
    };
  }

  if (semver.gt(fromClean, toClean)) {
    return {
      from: fromRaw,
      to: toRaw,
      fromClean,
      toClean,
      bump: "unknown",
      verdict: "invalid",
      headline: "Selected version is newer than latest",
      summary:
        "This may be a newer prerelease or a tag that is not the npm latest dist-tag.",
      releasesBehind: 0,
      majorsCrossed: 0,
      fromPublishedAt,
      toPublishedAt,
      daysBetween: daysBetweenIso(fromPublishedAt, toPublishedAt),
      intermediateMajors: [],
    };
  }

  if (bump === "patch") {
    return {
      from: fromRaw,
      to: toRaw,
      fromClean,
      toClean,
      bump,
      verdict: "patch",
      headline: "Patch upgrade available",
      summary:
        "Usually low risk - bug fixes and security patches. Review the changelog if subtle behaviour matters.",
      releasesBehind,
      majorsCrossed: 0,
      fromPublishedAt,
      toPublishedAt,
      daysBetween: daysBetweenIso(fromPublishedAt, toPublishedAt),
      intermediateMajors: [],
    };
  }

  if (bump === "minor") {
    return {
      from: fromRaw,
      to: toRaw,
      fromClean,
      toClean,
      bump,
      verdict: "minor",
      headline: "Minor upgrade available",
      summary:
        "Likely backward compatible under semver, but new features can still change defaults. Skim the release notes before upgrading.",
      releasesBehind,
      majorsCrossed: 0,
      fromPublishedAt,
      toPublishedAt,
      daysBetween: daysBetweenIso(fromPublishedAt, toPublishedAt),
      intermediateMajors: [],
    };
  }

  return {
    from: fromRaw,
    to: toRaw,
    fromClean,
    toClean,
    bump: "major",
    verdict: "major",
    headline:
      majorsCrossed > 1
        ? `Major upgrade - crosses ${majorsCrossed} major lines`
        : "Major upgrade available",
    summary:
      majorsCrossed > 1
        ? `This jump crosses multiple major versions (${intermediateMajors
            .map((v) => `${semver.major(v)}.x`)
            .join(" → ")}). Expect breaking changes; upgrade in steps if possible.`
        : "Expect breaking changes. Check the migration guide and peer dependency requirements before upgrading.",
    releasesBehind,
    majorsCrossed,
    fromPublishedAt,
    toPublishedAt,
    daysBetween: daysBetweenIso(fromPublishedAt, toPublishedAt),
    intermediateMajors,
  };
}

export function defaultFromVersion(
  latest: string | undefined,
  versions: string[],
): string {
  if (!versions.length) return "";
  if (latest && versions[0] === latest && versions.length > 1) {
    return versions[1];
  }
  if (latest && versions.includes(latest)) {
    const idx = versions.indexOf(latest);
    return versions[idx + 1] ?? versions[0];
  }
  return versions[0] ?? "";
}
