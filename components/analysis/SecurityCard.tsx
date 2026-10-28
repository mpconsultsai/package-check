"use client";

import { useEffect, useMemo, useState } from "react";
import { SelectField } from "@/components/SelectField";
import { useLiveMessage } from "@/components/LiveAnnouncer";
import { AdvisoryLinks } from "./AdvisoryLinks";
import { AdvisoryDescription } from "./AdvisoryDescription";
import {
  severityBadgeClass,
  severityBorderClass,
} from "@/lib/utils/severity";
import {
  formatEpssPercent,
  sortByThreatPriority,
} from "@/lib/utils/vuln-priority";
import { formatPublishDate } from "@/lib/utils/format";
import {
  npmReleaseCooldownCaution,
  npmReleaseCooldownStatus,
} from "@/lib/packages/npm-release-cooldown";
import { useNpmReleaseCooldownHours } from "@/lib/prefs/use-npm-release-cooldown-pref";
import {
  versionCheckVerdict,
  type VersionCheckVerdict,
} from "@/lib/packages/version-check";
import type { PackageEcosystem } from "@/lib/packages/package-routes";

interface VersionVuln {
  id?: string;
  title: string;
  severity: string;
  description: string;
  url?: string;
  vulnerableVersionRange?: string;
  patchedVersions?: string;
  cveId?: string;
  osvUrl?: string;
  knownExploited?: boolean;
  epssScore?: number;
  epssPercentile?: number;
}

interface SecurityResult {
  hasVulnerabilities: boolean;
  totalCount: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  vulnerabilities: VersionVuln[];
}

interface SecurityCardProps {
  packageName: string;
  latestVersion?: string;
  availableVersions: string[];
  /** npm packument `time` map - version → ISO publish date */
  versionTimes?: Record<string, string>;
  selectedVersion: string;
  onVersionChange: (v: string) => void;
  securityLoading: boolean;
  ecosystem?: PackageEcosystem;
  securityData: {
    error?: string;
    security?: SecurityResult;
    deprecated?: string | null;
    depsDev?: {
      saferVersion: string | null;
      depsDevUrl: string;
    };
  } | null;
}

const TIME_META = new Set(["created", "modified", "unpublished"]);

const isPublishedVersion = (
  version: string,
  versionTimes?: Record<string, string>,
): boolean => {
  if (!versionTimes) return false;
  if (TIME_META.has(version)) return false;
  // Empty publish dates still count (common for newly indexed Maven releases).
  return Object.prototype.hasOwnProperty.call(versionTimes, version);
};

const SEVERITY_SEGMENTS = [
  { key: "critical" as const, label: "Critical", className: "bg-purple-500" },
  { key: "high" as const, label: "High", className: "bg-red-500" },
  { key: "moderate" as const, label: "Moderate", className: "bg-orange-500" },
  { key: "low" as const, label: "Low", className: "bg-yellow-400" },
];

function SeverityMix({ security }: { security: SecurityResult }) {
  const total = security.totalCount;
  if (total <= 0) return null;

  const segments = SEVERITY_SEGMENTS.map((seg) => ({
    ...seg,
    count: security[seg.key],
  })).filter((seg) => seg.count > 0);

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Severity mix
      </p>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(", ")}
      >
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={`${seg.className} min-w-[2px]`}
            style={{ width: `${(seg.count / total) * 100}%` }}
            title={`${seg.label}: ${seg.count}`}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {segments.map((seg) => (
          <li key={seg.key} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-sm ${seg.className}`}
              aria-hidden="true"
            />
            {seg.label} {seg.count}
            <span className="text-gray-400 dark:text-gray-400">
              ({Math.round((seg.count / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function verdictPanelClass(verdict: VersionCheckVerdict): string {
  switch (verdict) {
    case "use":
      return "border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-50";
    case "wait":
      return "border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-50";
    case "prefer_other":
      return "border-sky-200 bg-sky-50/80 text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-50";
    case "avoid":
      return "border-red-200 bg-red-50/80 text-red-950 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-50";
  }
}

function verdictBadge(verdict: VersionCheckVerdict): string {
  switch (verdict) {
    case "use":
      return "Use";
    case "wait":
      return "Wait";
    case "prefer_other":
      return "Prefer other";
    case "avoid":
      return "Avoid";
  }
}

export function SecurityCard({
  packageName,
  latestVersion,
  availableVersions,
  versionTimes,
  selectedVersion,
  onVersionChange,
  securityLoading,
  securityData,
  ecosystem = "npm",
}: SecurityCardProps) {
  const cooldownHours = useNpmReleaseCooldownHours();
  const hasSecurity = Boolean(securityData?.security && !securityData?.error);
  const sortedVulns = hasSecurity
    ? sortByThreatPriority(securityData!.security!.vulnerabilities)
    : [];

  const kevCount = sortedVulns.filter((v) => v.knownExploited).length;

  const availableVersionsKey = availableVersions.join("\0");
  const versions = useMemo(
    () =>
      availableVersions.length > 0
        ? availableVersions
        : latestVersion
          ? [latestVersion]
          : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by availableVersionsKey
    [availableVersionsKey, latestVersion],
  );
  const versionsKey = versions.join("\0");
  // Parent already slices to 10; fewer than that means the package has no
  // older releases beyond the listed set.
  const showOlderVersions = versions.length >= 10;

  const [mode, setMode] = useState<"listed" | "custom">("listed");
  const [listedVersion, setListedVersion] = useState(
    () =>
      (selectedVersion && versions.includes(selectedVersion)
        ? selectedVersion
        : versions[0]) || "",
  );
  const [customVersion, setCustomVersion] = useState("");
  const [customNotFound, setCustomNotFound] = useState(false);
  const [checkedCustom, setCheckedCustom] = useState<string | null>(null);

  const defaultListed =
    (latestVersion && versions.includes(latestVersion)
      ? latestVersion
      : versions[0]) || "";

  useEffect(() => {
    if (versions.length === 0) return;
    setListedVersion((prev) => (versions.includes(prev) ? prev : versions[0]));
  }, [versionsKey, versions]);

  useEffect(() => {
    if (showOlderVersions) return;
    setMode("listed");
    setCustomVersion("");
    setCustomNotFound(false);
    setCheckedCustom(null);
  }, [showOlderVersions]);

  const applyListedVersion = (version: string) => {
    setListedVersion(version);
    setCustomNotFound(false);
    onVersionChange(version);
  };

  const applyCustomVersion = () => {
    const version = customVersion.trim();
    if (!version) return;
    if (versionTimes && !isPublishedVersion(version, versionTimes)) {
      setCustomNotFound(true);
      return;
    }
    setCustomNotFound(false);
    setCheckedCustom(version);
    onVersionChange(version);
  };

  const chooseMode = (next: "listed" | "custom") => {
    if (next === mode) return;
    if (next === "custom" && !showOlderVersions) return;
    setMode(next);
    setCustomVersion("");
    setCustomNotFound(false);
    setCheckedCustom(null);
    if (next === "listed") {
      if (defaultListed) applyListedVersion(defaultListed);
      return;
    }
    if (defaultListed) setListedVersion(defaultListed);
  };

  const effectiveMode = showOlderVersions ? mode : "listed";

  const showSecurity =
    effectiveMode === "listed" ||
    Boolean(checkedCustom && checkedCustom === customVersion.trim());

  const publishedAt =
    selectedVersion && versionTimes ? versionTimes[selectedVersion] : null;
  const selectedPublished = formatPublishDate(publishedAt);
  const cooldownStatus =
    ecosystem === "npm"
      ? npmReleaseCooldownStatus({
          publishedAt,
          cooldownHours,
        })
      : { withinCooldown: false, hoursSincePublish: null };
  const cooldownNote =
    cooldownStatus.withinCooldown &&
    cooldownStatus.hoursSincePublish !== null
      ? npmReleaseCooldownCaution({
          hoursSincePublish: cooldownStatus.hoursSincePublish,
          cooldownHours,
        })
      : null;

  const check = useMemo(() => {
    if (!hasSecurity || !selectedVersion) return null;
    const security = securityData!.security!;
    return versionCheckVerdict({
      selectedVersion,
      security: {
        totalCount: security.totalCount,
        critical: security.critical,
        high: security.high,
        moderate: security.moderate,
        low: security.low,
      },
      deprecated: securityData?.deprecated ?? null,
      saferVersion: securityData?.depsDev?.saferVersion ?? null,
      publishedAt,
      cooldownHours: ecosystem === "npm" ? cooldownHours : 0,
      versionTimes: ecosystem === "npm" ? versionTimes : null,
    });
  }, [
    hasSecurity,
    selectedVersion,
    securityData,
    publishedAt,
    cooldownHours,
    versionTimes,
    ecosystem,
  ]);

  useLiveMessage(
    showSecurity && securityLoading
      ? `Checking ${packageName}@${selectedVersion || "…"}…`
      : null,
  );
  useLiveMessage(
    customNotFound
      ? "Version not found"
      : showSecurity && securityData?.error && !securityLoading
        ? securityData.error
        : null,
    { politeness: "assertive" },
  );
  useLiveMessage(
    showSecurity && !securityLoading && check
      ? check.headline
      : null,
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
      <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
        Pick a version to check whether it is safe to use. Advisories, release
        age, and deprecation drive the verdict.
      </p>
      {showOlderVersions ? (
        <div
          role="radiogroup"
          aria-label="Version source"
          className="flex gap-5 mb-3 border-b border-rule"
        >
          {(
            [
              { id: "listed" as const, label: "Last 10 versions" },
              { id: "custom" as const, label: "Older versions" },
            ] as const
          ).map((option) => {
            const selected = effectiveMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => chooseMode(option.id)}
                className={`-mb-px pb-2 text-sm font-medium border-b-2 transition-colors ${
                  selected
                    ? "border-signal font-semibold text-ink"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {effectiveMode === "listed" ? (
        <div>
          <label
            htmlFor="securityVersionSelect"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Version
          </label>
          <SelectField
            id="securityVersionSelect"
            value={listedVersion}
            onChange={(e) => applyListedVersion(e.target.value)}
            disabled={versions.length === 0 || securityLoading}
            className="w-full md:w-1/4"
          >
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
                {v === latestVersion ? " (latest)" : ""}
              </option>
            ))}
          </SelectField>
        </div>
      ) : (
        <div>
          <label
            htmlFor="securityVersionCustom"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Version
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="securityVersionCustom"
              type="text"
              value={customVersion}
              onChange={(e) => {
                setCustomVersion(e.target.value);
                if (customNotFound) setCustomNotFound(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCustomVersion();
                }
              }}
              placeholder="Enter version"
              spellCheck={false}
              autoComplete="off"
              disabled={showSecurity && securityLoading}
              className="w-full rounded-lg border border-gray-600 px-4 py-2 disabled:opacity-60 focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal md:w-1/4 dark:border-gray-400 dark:bg-gray-700 dark:text-white dark:focus:border-gray-300"
            />
            <button
              type="button"
              onClick={applyCustomVersion}
              disabled={(showSecurity && securityLoading) || !customVersion.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-ink text-paper hover:bg-signal disabled:opacity-50"
            >
              Check
            </button>
          </div>
          {customNotFound && (
            <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
              Version not found
            </p>
          )}
        </div>
      )}

      {showSecurity && securityLoading && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Checking {packageName}@{selectedVersion || "…"}…
        </p>
      )}

      {showSecurity && securityData?.error && !securityLoading && (
        <p className="mt-4 text-red-600 dark:text-red-400">{securityData.error}</p>
      )}

      {showSecurity && hasSecurity && !securityLoading && check && (
        <div className="mt-6 space-y-6">
          <div
            className={`rounded-xl border px-4 py-4 sm:px-5 ${verdictPanelClass(check.verdict)}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-black/5 dark:bg-white/10">
                {verdictBadge(check.verdict)}
              </span>
              <span className="font-mono text-xs opacity-80">
                {packageName}@{selectedVersion}
              </span>
            </div>
            <p className="mt-2 text-base font-semibold leading-snug">
              {check.headline}
            </p>
            <ul className="mt-2 space-y-1 text-sm leading-relaxed opacity-90">
              {check.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {check.recommendedVersion ? (
              <button
                type="button"
                onClick={() => onVersionChange(check.recommendedVersion!)}
                className="mt-3 inline-flex items-center rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper hover:bg-signal"
              >
                Check {check.recommendedVersion}
              </button>
            ) : null}
            {selectedPublished || cooldownNote ? (
              <p className="mt-3 text-xs leading-relaxed opacity-70">
                {[
                  selectedPublished ? `Released ${selectedPublished}` : null,
                  cooldownNote,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>

          <div className="border-t border-rule pt-4">
            <h3 className="font-semibold text-lg mb-3">
              Advisories on this version
            </h3>
            {securityData!.security!.hasVulnerabilities ? (
              <div className="space-y-2">
                <p className="text-red-600 dark:text-red-400 font-medium">
                  {securityData!.security!.totalCount}{" "}
                  {securityData!.security!.totalCount === 1
                    ? "vulnerability"
                    : "vulnerabilities"}{" "}
                  found
                  {kevCount > 0 && (
                    <span className="text-red-800 dark:text-red-300 font-semibold">
                      {" "}
                      · {kevCount} on CISA KEV
                    </span>
                  )}
                </p>
                <SeverityMix security={securityData!.security!} />
                <div className="space-y-3 mt-4">
                  {sortedVulns.map((vuln, idx) => (
                    <div
                      key={vuln.id ?? idx}
                      className={`bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border-l-4 ${severityBorderClass(vuln.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="font-semibold">{vuln.title}</h4>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {vuln.knownExploited && (
                            <span
                              className="px-2 py-0.5 rounded text-xs font-semibold bg-red-800 text-white"
                              title="Listed in CISA Known Exploited Vulnerabilities catalog"
                            >
                              KEV
                            </span>
                          )}
                          {formatEpssPercent(vuln.epssScore) && (
                            <span
                              className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-950 dark:bg-amber-900/50 dark:text-amber-100"
                              title={
                                vuln.epssPercentile != null
                                  ? `EPSS ${formatEpssPercent(vuln.epssScore)} · ${(vuln.epssPercentile * 100).toFixed(0)}th percentile vs all CVEs`
                                  : "EPSS 30-day exploitation probability (FIRST.org)"
                              }
                            >
                              EPSS {formatEpssPercent(vuln.epssScore)}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${severityBadgeClass(vuln.severity)}`}
                          >
                            {vuln.severity}
                          </span>
                        </div>
                      </div>
                      <AdvisoryDescription markdown={vuln.description} />
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-400 mt-2">
                        {vuln.id && (
                          <span>
                            <strong>ID:</strong> {vuln.id}
                          </span>
                        )}
                        {vuln.cveId && vuln.cveId !== vuln.id && (
                          <span>
                            <strong>CVE:</strong> {vuln.cveId}
                          </span>
                        )}
                        {vuln.vulnerableVersionRange && (
                          <span>
                            <strong>Vulnerable:</strong>{" "}
                            {vuln.vulnerableVersionRange}
                          </span>
                        )}
                        {vuln.patchedVersions &&
                          vuln.patchedVersions !== "none" && (
                            <span className="text-green-600 dark:text-green-400">
                              <strong>Fixed in:</strong> {vuln.patchedVersions}
                            </span>
                          )}
                      </div>
                      <AdvisoryLinks
                        githubUrl={vuln.url}
                        osvUrl={vuln.osvUrl}
                        packageName={packageName}
                        version={selectedVersion}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-green-600 dark:text-green-400 font-medium">
                No known vulnerabilities for this version.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
