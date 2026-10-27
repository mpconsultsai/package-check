import semver from "semver";
import {
  npmReleaseCooldownCaution,
  npmReleaseCooldownStatus,
} from "@/lib/packages/npm-release-cooldown";

const TIME_META = new Set(["created", "modified", "unpublished"]);
const MS_PER_HOUR = 1000 * 60 * 60;

export type VersionCheckVerdict = "use" | "wait" | "prefer_other" | "avoid";

export type VersionCheckSecurityCounts = {
  totalCount: number;
  critical: number;
  high: number;
  moderate?: number;
  low?: number;
};

export type VersionCheckResult = {
  verdict: VersionCheckVerdict;
  /** Version to switch to when the selected one should not be used. */
  recommendedVersion: string | null;
  headline: string;
  reasons: string[];
};

function hasSevereAdvisories(security: VersionCheckSecurityCounts | null): boolean {
  if (!security) return false;
  return security.critical > 0 || security.high > 0;
}

function hasAnyAdvisories(security: VersionCheckSecurityCounts | null): boolean {
  if (!security) return false;
  return security.totalCount > 0;
}

function advisoryReason(security: VersionCheckSecurityCounts): string {
  const parts: string[] = [];
  if (security.critical > 0) {
    parts.push(
      `${security.critical} critical`,
    );
  }
  if (security.high > 0) {
    parts.push(`${security.high} high`);
  }
  if (security.moderate && security.moderate > 0) {
    parts.push(`${security.moderate} moderate`);
  }
  if (security.low && security.low > 0) {
    parts.push(`${security.low} low`);
  }
  const detail = parts.length > 0 ? parts.join(", ") : String(security.totalCount);
  return security.totalCount === 1
    ? `1 advisory (${detail}).`
    : `${security.totalCount} advisories (${detail}).`;
}

/**
 * Newest stable release strictly older than `selectedVersion` whose publish
 * time is outside the cooldown window. Null when none fits.
 */
export function previousStableOutsideCooldown(options: {
  versionTimes?: Record<string, string> | null;
  cooldownHours: number;
  selectedVersion: string;
  now?: number | Date;
}): string | null {
  const selected = options.selectedVersion.trim();
  const cooldownHours = Math.max(0, Math.floor(Number(options.cooldownHours)));
  if (!selected || !options.versionTimes || cooldownHours <= 0) return null;

  const now =
    options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "number"
        ? options.now
        : Date.now();

  const candidates = Object.keys(options.versionTimes)
    .filter((version) => !TIME_META.has(version))
    .filter((version) => {
      const cleaned = semver.valid(version);
      return Boolean(cleaned) && !semver.prerelease(cleaned!);
    })
    .filter((version) => version !== selected)
    .filter((version) => {
      const cleaned = semver.valid(version);
      const selectedClean = semver.valid(selected);
      if (!cleaned || !selectedClean) return false;
      return semver.lt(cleaned, selectedClean);
    })
    .sort((a, b) => semver.rcompare(a, b));

  for (const version of candidates) {
    const publishedAt = options.versionTimes[version];
    if (!publishedAt) continue;
    const published = new Date(publishedAt).getTime();
    if (Number.isNaN(published)) continue;
    const hoursSince = Math.floor((now - published) / MS_PER_HOUR);
    if (hoursSince >= cooldownHours) return version;
  }
  return null;
}

/**
 * Compact verdict for the Version check tab.
 * Priority: avoid → prefer_other → wait → use.
 */
export function versionCheckVerdict(options: {
  selectedVersion: string;
  security: VersionCheckSecurityCounts | null;
  deprecated?: string | null;
  saferVersion?: string | null;
  publishedAt?: string | null;
  cooldownHours?: number;
  versionTimes?: Record<string, string> | null;
  now?: number | Date;
}): VersionCheckResult {
  const selected = options.selectedVersion.trim() || "this version";
  const deprecated =
    typeof options.deprecated === "string" && options.deprecated.trim()
      ? options.deprecated.trim()
      : null;
  const safer =
    typeof options.saferVersion === "string" && options.saferVersion.trim()
      ? options.saferVersion.trim()
      : null;
  const security = options.security;
  const cooldownHours = Math.max(0, Math.floor(Number(options.cooldownHours ?? 0)));
  const cooldown = npmReleaseCooldownStatus({
    publishedAt: options.publishedAt,
    cooldownHours,
    now: options.now,
  });

  const reasons: string[] = [];

  if (deprecated) {
    reasons.push(`Deprecated: ${deprecated}`);
    return {
      verdict: "avoid",
      recommendedVersion: safer,
      headline: safer
        ? `Avoid ${selected} · prefer ${safer}`
        : `Avoid ${selected}`,
      reasons,
    };
  }

  if (hasSevereAdvisories(security) && !safer) {
    reasons.push(advisoryReason(security!));
    return {
      verdict: "avoid",
      recommendedVersion: null,
      headline: `Avoid ${selected}`,
      reasons,
    };
  }

  if (hasAnyAdvisories(security) && safer) {
    reasons.push(advisoryReason(security!));
    reasons.push(`deps.dev lists a clearer release: ${safer}.`);
    return {
      verdict: hasSevereAdvisories(security) ? "avoid" : "prefer_other",
      recommendedVersion: safer,
      headline: hasSevereAdvisories(security)
        ? `Avoid ${selected} · prefer ${safer}`
        : `Prefer ${safer} over ${selected}`,
      reasons,
    };
  }

  if (hasAnyAdvisories(security) && !safer) {
    // Moderate/low only, no clearer release — still usable with caution via `use`,
    // but surface the advisory count in reasons. Plan: avoid only for critical/high
    // without safer. Moderate/low alone → use with reason.
    reasons.push(advisoryReason(security!));
  }

  if (cooldown.withinCooldown && cooldown.hoursSincePublish !== null) {
    reasons.push(
      npmReleaseCooldownCaution({
        hoursSincePublish: cooldown.hoursSincePublish,
        cooldownHours,
      }),
    );
    const prior = previousStableOutsideCooldown({
      versionTimes: options.versionTimes,
      cooldownHours,
      selectedVersion: selected,
      now: options.now,
    });
    return {
      verdict: "wait",
      recommendedVersion: prior,
      headline: prior
        ? `Wait on ${selected} · consider ${prior}`
        : `Wait on ${selected}`,
      reasons,
    };
  }

  if (reasons.length === 0) {
    reasons.push("No known advisories for this version.");
  }

  return {
    verdict: "use",
    recommendedVersion: null,
    headline: `Use ${selected}`,
    reasons,
  };
}
