"use client";

import { useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { formatDaysSinceRelease } from "@/lib/utils/format";
import { describeLicense } from "@/lib/packages/license-info";
import { MetricsCard } from "./MetricsCard";
import { OpenSSFScorecardStrip } from "./OpenSSFScorecardStrip";
import { UpgradeAdvisorPanel } from "./UpgradeAdvisorPanel";
import { DependentsModal } from "./DependentsModal";
import { CopyButton } from "@/components/CopyButton";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { packagePagePath, registryLabel } from "@/lib/packages/package-routes";
import { featuresForEcosystem } from "@/lib/packages/ecosystem-features";
import { LinkifiedText } from "@/components/LinkifiedText";
import { dotnetApiReferenceUrl } from "@/lib/nuget/nuget-description";
import type { InstallScript } from "@/lib/packages/install-scripts";
import {
  isNpmTypesPackage,
  npmMaintainerGithubUrl,
  npmModuleFormatLabel,
  provenanceCommitUrl,
  provenanceRepoLabel,
  type BundleModuleShare,
  type NpmModuleFormat,
} from "@/lib/packages/npm-package-facts";
import {
  npmProvenanceDowngradeNote,
  type NpmProvenance,
} from "@/lib/packages/npm-provenance";
import {
  npmReleaseCooldownCaution,
  npmReleaseCooldownStatus,
} from "@/lib/packages/npm-release-cooldown";
import { useNpmReleaseCooldownHours } from "@/lib/prefs/use-npm-release-cooldown-pref";

/** npm search `dependents` count - badge when widely depended-on. */
const POPULAR_MIN_DEPENDENTS = 1000;
const VERY_POPULAR_MIN_DEPENDENTS = 10_000;
const MAX_KEYWORD_BADGES = 10;

interface PackageInfo {
  name: string;
  latestVersion?: string;
  version?: string;
  license: string;
  description?: string;
  npmUrl: string;
  homepage?: string;
  repository?: string;
  daysSinceLastRelease?: number | null;
  lastReleaseLabel?: string | null;
  /** Direct runtime + peer dependency count for the latest version. */
  directDependencyCount?: number | null;
  dependents?: number;
  keywords?: string[];
  engines?: Record<string, string> | null;
  installScripts?: InstallScript[] | null;
  moduleFormat?: NpmModuleFormat | null;
  typesIncluded?: boolean | null;
  typesFor?: string | null;
  typesPackage?: string | null;
  provenance?: NpmProvenance | null;
  maintainers?: string[] | null;
  publishRiskNotes?: string[] | null;
  supportedFrameworks?: string[] | null;
  commonlyUsedTypes?: string[] | null;
  descriptionNote?: string | null;
}

interface PackageInfoCardProps {
  packageInfo: PackageInfo;
  metrics?: {
    downloads: number;
    stars: number;
    openIssues: number;
    qualityScore: number;
    releaseCount?: number;
    bundleSize?: number;
    bundleGzip?: number;
    bundleComposition?: BundleModuleShare[] | null;
    distributionSize?: number;
    distributionSizeKind?: string;
    distributionFilename?: string;
  } | null;
  metricsLoading?: boolean;
  versionTimes?: Record<string, string> | null;
  ecosystem?: PackageEcosystem;
  latestSecurity?: {
    totalCount?: number;
    critical?: number;
    high?: number;
    moderate?: number;
    low?: number;
  } | null;
}

const formatDependents = (count: number): string => {
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (count >= 1000) {
    const k = count / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return String(count);
};

const keywordBadgeLabels = (
  keywords: string[] | undefined,
  packageName: string,
): string[] => {
  if (!keywords?.length) return [];

  const nameLower = packageName.toLowerCase();
  const baseName = nameLower.includes("/")
    ? nameLower.slice(nameLower.lastIndexOf("/") + 1)
    : nameLower;

  return [
    ...new Set(
      keywords
        .map((k) => k.trim())
        .filter(Boolean)
        .filter((k) => {
          const key = k.toLowerCase();
          return key !== nameLower && key !== baseName;
        }),
    ),
  ].slice(0, MAX_KEYWORD_BADGES);
};

const PopularBadge = ({ dependents }: { dependents: number }) => {
  if (dependents < POPULAR_MIN_DEPENDENTS) return null;

  const very = dependents >= VERY_POPULAR_MIN_DEPENDENTS;
  const label = very ? "Very popular" : "Popular";

  return (
    <span
      className="inline-flex items-center bg-ink px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-paper"
      title={`${dependents.toLocaleString()} packages on npm depend on this (${formatDependents(dependents)})`}
    >
      {label}
    </span>
  );
};

const ZeroDependenciesBadge = () => (
  <span
    className="inline-flex items-center border border-ink px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-ink"
    title="No direct runtime or peer dependencies declared for the latest version"
  >
    Zero dependencies
  </span>
);

const KeywordBadges = ({ labels }: { labels: string[] }) => {
  if (labels.length === 0) return null;

  return (
    <>
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex items-center border border-rule px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:text-gray-300"
        >
          {label}
        </span>
      ))}
    </>
  );
};

const ReleaseCooldownNote = ({ message }: { message: string }) => (
  <span className="text-sm font-sans font-normal text-amber-800 dark:text-amber-300">
    {message}
  </span>
);

export const PackageInfoCard = ({
  packageInfo,
  metrics,
  metricsLoading = false,
  versionTimes,
  latestSecurity,
  ecosystem = "npm",
}: PackageInfoCardProps) => {
  const features = featuresForEcosystem(ecosystem);
  const registryName = registryLabel(ecosystem);
  const releaseCooldownHours = useNpmReleaseCooldownHours();
  const [section, setSection] = useState<
    "info" | "metrics" | "scorecard" | "upgrade"
  >("info");
  const [dependentsOpen, setDependentsOpen] = useState(false);
  const closeDependents = useCallback(() => setDependentsOpen(false), []);

  const latestVersion =
    packageInfo.latestVersion || packageInfo.version || "";
  const latestPublishedAt =
    ecosystem === "npm" && latestVersion && versionTimes
      ? versionTimes[latestVersion]
      : null;
  const cooldownStatus =
    ecosystem === "npm"
      ? npmReleaseCooldownStatus({
          publishedAt: latestPublishedAt,
          cooldownHours: releaseCooldownHours,
        })
      : { withinCooldown: false, hoursSincePublish: null };
  const cooldownCaution =
    cooldownStatus.withinCooldown &&
    cooldownStatus.hoursSincePublish !== null
      ? npmReleaseCooldownCaution({
          hoursSincePublish: cooldownStatus.hoursSincePublish,
          cooldownHours: releaseCooldownHours,
        })
      : null;
  const popularBadge =
    packageInfo.dependents !== undefined ? (
      <PopularBadge dependents={packageInfo.dependents} />
    ) : null;
  const zeroDependencies =
    typeof packageInfo.directDependencyCount === "number" &&
    packageInfo.directDependencyCount === 0;
  const zeroDependenciesBadge = zeroDependencies ? (
    <ZeroDependenciesBadge />
  ) : null;
  const keywordLabels = keywordBadgeLabels(
    packageInfo.keywords,
    packageInfo.name,
  );
  const keywordBadges = <KeywordBadges labels={keywordLabels} />;
  const badgeRow =
    popularBadge || zeroDependenciesBadge || keywordLabels.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        {popularBadge}
        {zeroDependenciesBadge}
        {keywordBadges}
      </div>
    ) : null;
  const licenseInfo = describeLicense(packageInfo.license);
  const nodeEngine = packageInfo.engines?.node?.trim() || null;
  const npmEngine = packageInfo.engines?.npm?.trim() || null;
  const installScripts =
    ecosystem === "npm" ? (packageInfo.installScripts ?? []) : [];
  const pythonEngine = packageInfo.engines?.python?.trim() || null;
  const dotnetEngine = packageInfo.engines?.dotnet?.trim() || null;
  const supportedFrameworks = (packageInfo.supportedFrameworks ?? []).filter(
    (framework) => framework.trim().length > 0,
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
      <div
        role="radiogroup"
        aria-label="Package details"
        className="mb-4 flex gap-5 border-b border-rule"
      >
        {(
          [
            { id: "info" as const, label: "Info" },
            { id: "metrics" as const, label: "Metrics" },
            { id: "scorecard" as const, label: "Scorecard" },
            ...(features.upgradeAdvisor
              ? [{ id: "upgrade" as const, label: "Upgrade" }]
              : []),
          ] as const
        ).map((option) => {
          const selected = section === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setSection(option.id)}
              className={`-mb-px pb-2 text-sm border-b-2 transition-colors ${
                selected
                  ? "border-signal font-semibold text-ink"
                  : "border-transparent font-medium text-gray-500 dark:text-gray-400 hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {section === "metrics" ? (
        metricsLoading || !metrics ? (
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-6 sm:gap-4 animate-pulse"
            role="status"
          >
            <span className="sr-only">Loading package metrics</span>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700 mb-2" />
                <div className="h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        ) : (
          <MetricsCard
            metrics={metrics}
            showDownloads={features.downloadMetrics}
            downloadsAreTotal={features.downloadsAreTotal}
            embedded
          />
        )
      ) : section === "scorecard" ? (
        <OpenSSFScorecardStrip
          packageName={packageInfo.name}
          repository={packageInfo.repository}
          embedded
        />
      ) : section === "upgrade" ? (
        <UpgradeAdvisorPanel
          packageName={packageInfo.name}
          latestVersion={packageInfo.latestVersion || packageInfo.version}
          versionTimes={versionTimes}
          latestSecurity={latestSecurity}
        />
      ) : (
        <>
          {packageInfo.description && (
            <div className="mb-5">
              <p className="max-w-3xl text-lg leading-relaxed text-ink sm:text-xl">
                <LinkifiedText
                  text={packageInfo.description}
                  compactLinks
                />
              </p>
              {(packageInfo.commonlyUsedTypes?.length ?? 0) > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Commonly used types
                  </h3>
                  <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                    {packageInfo.commonlyUsedTypes!.map((typeName) => {
                      const href = dotnetApiReferenceUrl(typeName);
                      return (
                        <li
                          key={typeName}
                          className="font-mono text-sm leading-6 text-gray-800 dark:text-gray-200"
                        >
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link"
                            >
                              {typeName}
                            </a>
                          ) : (
                            typeName
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {packageInfo.descriptionNote && (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  <LinkifiedText
                    text={packageInfo.descriptionNote}
                    compactLinks
                  />
                </p>
              )}
              {badgeRow && <div className="mt-3">{badgeRow}</div>}
            </div>
          )}
          {!packageInfo.description && badgeRow && (
            <div className="mb-6">{badgeRow}</div>
          )}
          <dl className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
            <Fact label="Latest version">
              <span className="inline-flex items-center gap-1.5 font-mono">
                <span>{packageInfo.latestVersion || packageInfo.version}</span>
                {(packageInfo.latestVersion || packageInfo.version) && (
                  <CopyButton
                    value={
                      packageInfo.latestVersion || packageInfo.version || ""
                    }
                    label="Copy version"
                  />
                )}
              </span>
            </Fact>

            {(packageInfo.lastReleaseLabel ||
              (packageInfo.daysSinceLastRelease !== null &&
                packageInfo.daysSinceLastRelease !== undefined) ||
              cooldownCaution) && (
              <Fact label="Last release">
                <span className="flex flex-col gap-1">
                  {(packageInfo.lastReleaseLabel ||
                    (packageInfo.daysSinceLastRelease !== null &&
                      packageInfo.daysSinceLastRelease !== undefined)) && (
                    <span>
                      {packageInfo.lastReleaseLabel ??
                        formatDaysSinceRelease(
                          packageInfo.daysSinceLastRelease!,
                        )}
                    </span>
                  )}
                  {cooldownCaution ? (
                    <ReleaseCooldownNote message={cooldownCaution} />
                  ) : null}
                </span>
              </Fact>
            )}

            {pythonEngine && ecosystem === "pypi" && (
              <Fact label="Requires Python">
                <span className="font-mono">{pythonEngine}</span>
              </Fact>
            )}

            {ecosystem === "maven" && packageInfo.name.includes(":") && (
              <Fact label="Maven coordinate">
                <span className="font-mono break-all">{packageInfo.name}</span>
              </Fact>
            )}

            {ecosystem === "nuget" && supportedFrameworks.length > 0 && (
              <Fact label="Supported frameworks" wide>
                <ul
                  className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm"
                  aria-label="Supported frameworks"
                >
                  {supportedFrameworks.map((framework) => (
                    <li key={framework}>{framework}</li>
                  ))}
                </ul>
              </Fact>
            )}

            {dotnetEngine &&
              ecosystem === "nuget" &&
              supportedFrameworks.length === 0 && (
              <Fact label="Target framework">
                <span className="font-mono">{dotnetEngine}</span>
              </Fact>
            )}

            {nodeEngine && ecosystem === "npm" && (
              <Fact label="Node">
                <span className="font-mono">{nodeEngine}</span>
              </Fact>
            )}

            {npmEngine && ecosystem === "npm" && (
              <Fact label="npm">
                <span className="font-mono">{npmEngine}</span>
              </Fact>
            )}

            {ecosystem === "npm" && packageInfo.moduleFormat && (
              <Fact label="Module format">
                <span className="font-mono">
                  {npmModuleFormatLabel(packageInfo.moduleFormat)}
                </span>
              </Fact>
            )}

            {ecosystem === "npm" &&
              typeof packageInfo.typesIncluded === "boolean" &&
              !isNpmTypesPackage(packageInfo.name) && (
                <Fact label="TypeScript types">
                  {packageInfo.typesIncluded ? "Included" : "Not included"}
                  {packageInfo.typesFor && (
                    <span className="mt-1 block text-xs font-normal leading-relaxed text-gray-500 dark:text-gray-400">
                      Type definitions for{" "}
                      <Link
                        href={packagePagePath("npm", packageInfo.typesFor)}
                        scroll={false}
                        className="link"
                      >
                        {packageInfo.typesFor}
                      </Link>
                      .
                    </span>
                  )}
                  {!packageInfo.typesIncluded && packageInfo.typesPackage && (
                    <span className="mt-1 block text-xs font-normal leading-relaxed text-gray-500 dark:text-gray-400">
                      Published separately as{" "}
                      <Link
                        href={packagePagePath("npm", packageInfo.typesPackage)}
                        scroll={false}
                        className="link"
                      >
                        {packageInfo.typesPackage}
                      </Link>
                      .
                    </span>
                  )}
                  {!packageInfo.typesIncluded && !packageInfo.typesPackage && (
                    <span className="mt-1 block text-xs font-normal leading-relaxed text-gray-500 dark:text-gray-400">
                      TypeScript projects may need a separate @types package.
                    </span>
                  )}
                </Fact>
              )}

            {ecosystem === "npm" && packageInfo.provenance && (
              <Fact label="Provenance">
                <ProvenanceFact provenance={packageInfo.provenance} />
              </Fact>
            )}

            {ecosystem === "npm" &&
              ((packageInfo.maintainers?.length ?? 0) > 0 ||
                (packageInfo.publishRiskNotes?.length ?? 0) > 0) && (
                <Fact label="Maintainers">
                  {(packageInfo.maintainers?.length ?? 0) > 0 ? (
                    <span className="font-mono text-sm font-normal">
                      {packageInfo.maintainers!.slice(0, 8).map((name, index) => (
                        <span key={name}>
                          {index > 0 ? ", " : ""}
                          <a
                            href={npmMaintainerGithubUrl(name)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link"
                          >
                            {name}
                          </a>
                        </span>
                      ))}
                      {packageInfo.maintainers!.length > 8
                        ? ` and ${packageInfo.maintainers!.length - 8} more`
                        : ""}
                    </span>
                  ) : null}
                  {(packageInfo.publishRiskNotes ?? []).map((note) => (
                    <span
                      key={note}
                      className="mt-1 block text-xs font-normal leading-relaxed text-amber-800 dark:text-amber-300"
                    >
                      {note}
                    </span>
                  ))}
                </Fact>
              )}

            {installScripts.length > 0 && (
              <Fact label="Install scripts" wide>
                <ul className="space-y-2" aria-label="Install scripts">
                  {installScripts.map((script) => (
                    <li key={script.name}>
                      <span className="font-mono text-sm">{script.name}</span>
                      <span className="mt-0.5 block whitespace-pre-wrap break-all font-mono text-xs font-normal leading-relaxed text-gray-600 dark:text-gray-400">
                        {script.command}
                      </span>
                    </li>
                  ))}
                </ul>
              </Fact>
            )}

            <Fact label="Licence">
              <span className="break-all font-mono">
                {licenseInfo?.href ? (
                  <a
                    href={licenseInfo.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link"
                  >
                    {licenseInfo.id}
                  </a>
                ) : (
                  licenseInfo?.id ?? packageInfo.license
                )}
              </span>
              {licenseInfo?.summary && (
                <span className="mt-1 block text-xs font-normal leading-relaxed text-gray-500 dark:text-gray-400">
                  {licenseInfo.summary}
                </span>
              )}
            </Fact>

            {features.relatedPackages &&
              packageInfo.dependents !== undefined && (
              <Fact
                label="Dependents"
                action={
                  packageInfo.dependents > 0 ? (
                    <button
                      type="button"
                      onClick={() => setDependentsOpen(true)}
                      className="link normal-case tracking-normal"
                      title="View dependents"
                      aria-label="View dependents"
                    >
                      view
                    </button>
                  ) : null
                }
              >
                <span className="font-mono tabular-nums">
                  {packageInfo.dependents.toLocaleString()}
                </span>
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                  packages depend on this
                </span>
              </Fact>
            )}
          </dl>

          {features.relatedPackages && (
            <DependentsModal
              packageName={packageInfo.name}
              dependentCount={packageInfo.dependents}
              open={dependentsOpen}
              onClose={closeDependents}
            />
          )}

          <p className="mt-4 border-t border-rule pt-3 text-sm">
            <a
              href={packageInfo.npmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              View on {registryName} ↗
            </a>
          </p>
        </>
      )}
    </div>
  );
};

const ProvenanceFact = ({ provenance }: { provenance: NpmProvenance }) => {
  const noteClass =
    "mt-1 block text-xs font-normal leading-relaxed text-gray-500 dark:text-gray-400";
  const downgradeNote = npmProvenanceDowngradeNote(
    provenance.priorAttestedVersion,
  );
  if (!provenance.verified) {
    return (
      <>
        No signed build
        <span className={noteClass}>
          The latest version has no signed link to a public CI build.
        </span>
        {downgradeNote ? (
          <span className="mt-1 block text-xs font-normal leading-relaxed text-amber-800 dark:text-amber-300">
            {downgradeNote}
          </span>
        ) : null}
      </>
    );
  }

  const commitUrl =
    provenance.repositoryUrl && provenance.commit
      ? provenanceCommitUrl(provenance.repositoryUrl, provenance.commit)
      : null;
  const repoLabel = provenance.repositoryUrl
    ? provenanceRepoLabel(provenance.repositoryUrl)
    : null;
  const shortCommit = provenance.commit?.slice(0, 7);

  return (
    <>
      Verified build
      {commitUrl && repoLabel && shortCommit ? (
        <span className={noteClass}>
          Built from{" "}
          <a
            href={commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            {repoLabel}@{shortCommit}
          </a>
          {provenance.ref ? ` (${provenance.ref})` : ""}.
        </span>
      ) : (
        <span className={noteClass}>
          Signed build recorded by the registry.
        </span>
      )}
    </>
  );
};

const Fact = ({
  label,
  action,
  wide = false,
  children,
}: {
  label: string;
  action?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) => (
  <div className={`border-t border-rule py-3 ${wide ? "md:col-span-2" : ""}`}>
    <dt className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
      {label}
      {action}
    </dt>
    <dd className="mt-1 text-base font-medium text-ink">{children}</dd>
  </div>
);
