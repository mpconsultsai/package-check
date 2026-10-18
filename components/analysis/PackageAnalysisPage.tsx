"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import semver from "semver";
import { listStablePypiVersions } from "@/lib/pypi/pypi-version";
import { listStableNugetVersions } from "@/lib/nuget/nuget-version";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { featuresForEcosystem } from "@/lib/packages/ecosystem-features";
import { setEcosystemPreference } from "@/lib/prefs/ecosystem-pref";
import { fetchJson, friendlyFetchError, isServiceStartingError } from "@/lib/prefs/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import { useShellSearchLoading } from "@/components/AppShell";
import { ServiceStartingNotice } from "@/components/ServiceStartingNotice";
import { usePackageGithubLink } from "@/components/header-github";
import { WhatWeCheck } from "@/components/WhatWeCheck";
import { WatchToggle } from "@/components/Watchlist";
import { useWatchlistActions } from "@/lib/prefs/use-watchlist";
import { useAiAnalysisEnabled, useAiAnalysisPrefReady } from "@/lib/prefs/use-ai-analysis-pref";
import { getAiAnalysisEnabled } from "@/lib/prefs/ai-analysis-pref";
import type { WatchlistSummary } from "@/lib/prefs/watchlist-store";
import {
  PackageInfoCard,
  MetricsChartsCard,
  DependenciesCard,
  SecurityCard,
  AIAnalysisCard,
  SimilarPackagesCard,
  OverviewTabs,
  InsightTabs,
  AnalysisPanel,
  PackageNameHeader,
  type OverviewTabId,
  type InsightTabId,
} from "@/components/analysis";
import { snapshotFromAnalysis } from "@/lib/packages/package-compare";
import type { ClientAnalysisResponse } from "@/lib/packages/analysis-response";
import type { SecuritySummary } from "@/lib/data-fetchers/security";

type ApiErrorBody = { error?: string };
type VersionSecurityPayload = {
  security?: SecuritySummary;
  error?: string;
};

function summaryFromAnalysis(data: ClientAnalysisResponse): WatchlistSummary {
  return {
    version:
      data?.packageInfo?.latestVersion &&
      data.packageInfo.latestVersion !== "Unknown"
        ? data.packageInfo.latestVersion
        : undefined,
    qualityScore: data?.metrics?.qualityScore,
    vulnerabilityCount: data?.security?.totalCount,
    deprecated: Boolean(data?.npm?.deprecated),
    recommendation: data?.ai?.recommendation,
  };
}

export function PackageAnalysisPage({
  ecosystem,
  nameFromPath,
}: {
  ecosystem: PackageEcosystem;
  nameFromPath: string;
}) {
  return (
    <PackagePageContent
      key={`${ecosystem}:${nameFromPath}`}
      ecosystem={ecosystem}
      nameFromPath={nameFromPath}
    />
  );
}

function AIAnalysisSkeleton() {
  return (
    <div
      className="rounded-lg bg-white p-4 shadow-lg dark:bg-gray-800 sm:p-6"
      role="status"
    >
      <span className="sr-only">Generating AI analysis</span>
      <div className="animate-pulse" aria-hidden="true">
        <div className="flex items-end justify-between gap-4 border-b border-rule pb-4">
          <div className="h-8 w-36 bg-gray-200 dark:bg-gray-700" />
          <div className="h-12 w-24 bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`space-y-1.5 py-3 ${i === 0 ? "pr-3" : "px-3"}`}>
              <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
        <div className="space-y-2 py-5">
          <div className="h-4 w-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-11/12 bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-4/5 bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    </div>
  );
}

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="space-y-3 animate-pulse" aria-hidden="true">
        <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-full rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}

function PackagePageContent({
  ecosystem,
  nameFromPath,
}: {
  ecosystem: PackageEcosystem;
  nameFromPath: string;
}) {
  const features = featuresForEcosystem(ecosystem);
  const aiEnabled = useAiAnalysisEnabled();
  const aiPrefReady = useAiAnalysisPrefReady();
  const [loading, setLoading] = useState(Boolean(nameFromPath));
  const [aiLoading, setAiLoading] = useState(false);
  const [analysisData, setAnalysisData] =
    useState<ClientAnalysisResponse | null>(null);
  usePackageGithubLink(analysisData?.packageInfo?.repository);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [versionToCheck, setVersionToCheck] = useState("");
  const [versionSecurityData, setVersionSecurityData] =
    useState<VersionSecurityPayload | null>(null);
  const [versionSecurityLoading, setVersionSecurityLoading] = useState(false);
  const [overviewTab, setOverviewTab] = useState<OverviewTabId>("info");
  const [insightTab, setInsightTab] = useState<InsightTabId>("ai");
  const [chartsOpened, setChartsOpened] = useState(false);
  const versionCheckRequestId = useRef(0);
  const versionCheckAbort = useRef<AbortController | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const checkedVersionRef = useRef<string | null>(null);

  const resetSecurityCheck = () => {
    versionCheckRequestId.current += 1;
    versionCheckAbort.current?.abort();
    setVersionToCheck("");
    setVersionSecurityData(null);
    setVersionSecurityLoading(false);
    checkedVersionRef.current = null;
  };

  const loadAiAnalysis = useCallback(async (name: string, signal: AbortSignal) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const { ok, data } = await fetchJson<
        ClientAnalysisResponse & ApiErrorBody
      >(
        `${apiPaths.analysis.ai}?package=${encodeURIComponent(name)}&ecosystem=${ecosystem}`,
        {
          signal,
          timeoutMs: 120_000,
          retries: 3,
          retryDelayMs: 2000,
        },
      );
      if (signal.aborted) return;
      if (!ok) {
        setAiError(data.error || "Failed to generate AI analysis");
        return;
      }
      const ai = data.ai;
      const softFail =
        !ai ||
        (typeof ai.summary === "string" &&
          ai.summary.startsWith("Unable to generate AI analysis"));
      if (softFail) {
        setAiError("Failed to generate AI analysis");
        setAnalysisData((prev) => {
          if (!prev) return { ...data, ai: null };
          return {
            ...prev,
            ...data,
            ai: null,
            metrics: {
              ...prev.metrics,
              ...data.metrics,
            },
            errors: {
              ...prev.errors,
              ...data.errors,
              ai: "Failed to generate AI analysis",
            },
          };
        });
        return;
      }
      setAnalysisData((prev) => {
        if (!prev) return data;
        return {
          ...prev,
          ...data,
          ai: data.ai,
          metrics: {
            ...prev.metrics,
            ...data.metrics,
          },
          errors: {
            ...prev.errors,
            ...data.errors,
          },
        };
      });
    } catch (err: unknown) {
      if (signal.aborted) return;
      setAiError(friendlyFetchError(err));
    } finally {
      if (!signal.aborted) setAiLoading(false);
    }
  }, [ecosystem]);

  const loadAnalysis = useCallback(
    async (name: string, withAi: boolean) => {
      analysisAbort.current?.abort();
      aiAbort.current?.abort();
      const controller = new AbortController();
      analysisAbort.current = controller;
      const aiController = new AbortController();
      aiAbort.current = aiController;

      setLoading(true);
      setAiLoading(withAi);
      setError(null);
      setAiError(null);
      setAnalysisData(null);
      setOverviewTab("info");
      setInsightTab(withAi ? "ai" : "security");
      setChartsOpened(false);
      resetSecurityCheck();

      // Start AI in parallel with metrics so the LLM is not blocked on analyze.
      if (withAi) {
        void loadAiAnalysis(name, aiController.signal);
      } else {
        setAiLoading(false);
      }

      try {
        const { ok, data } = await fetchJson<
          ClientAnalysisResponse & ApiErrorBody
        >(
          `${apiPaths.analysis.metrics}?package=${encodeURIComponent(name)}&ecosystem=${ecosystem}`,
          {
            signal: controller.signal,
            timeoutMs: 60_000,
            retries: 4,
            retryDelayMs: 2000,
          },
        );
        if (controller.signal.aborted) return;
        if (!ok) {
          aiController.abort();
          setError(data.error || "Failed to analyse package");
          setAiLoading(false);
          return;
        }

        const latest = data.packageInfo?.latestVersion;
        if (latest && latest !== "Unknown") {
          setVersionToCheck(latest);
          if (data.security) {
            setVersionSecurityData({ security: data.security });
            checkedVersionRef.current = `${name}@${latest}`;
          }
        }

        // Preserve AI if it finished first (race with parallel analyze-ai).
        setAnalysisData((prev) => {
          if (prev?.ai && !data.ai) {
            return {
              ...data,
              ai: prev.ai,
              errors: {
                ...data.errors,
                ...prev.errors,
              },
            };
          }
          return data;
        });
        setLoading(false);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        aiController.abort();
        setError(friendlyFetchError(err));
        setAiLoading(false);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [loadAiAnalysis, ecosystem],
  );

  useEffect(() => {
    setEcosystemPreference(ecosystem);
  }, [ecosystem]);

  useEffect(() => {
    if (!features.chartsTab && overviewTab === "charts") {
      setOverviewTab("info");
    }
    if (!features.relatedPackages && insightTab === "related") {
      setInsightTab(aiEnabled ? "ai" : "security");
    }
  }, [
    features.chartsTab,
    features.relatedPackages,
    overviewTab,
    insightTab,
    aiEnabled,
  ]);

  const handleOverviewTabChange = (tab: OverviewTabId) => {
    if (tab === "charts") setChartsOpened(true);
    setOverviewTab(tab);
  };

  const handleInsightTabChange = (tab: InsightTabId) => {
    setInsightTab(tab);
  };

  useEffect(() => {
    return () => {
      versionCheckAbort.current?.abort();
      analysisAbort.current?.abort();
      aiAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!nameFromPath) return;
    loadAnalysis(nameFromPath, getAiAnalysisEnabled());
    return () => {
      analysisAbort.current?.abort();
      aiAbort.current?.abort();
    };
  }, [nameFromPath, loadAnalysis]);

  useEffect(() => {
    if (!aiPrefReady) return;

    if (!aiEnabled) {
      aiAbort.current?.abort();
      setAiLoading(false);
      setAiError(null);
      setInsightTab((tab) => (tab === "ai" ? "security" : tab));
      return;
    }

    if (
      !nameFromPath ||
      loading ||
      !analysisData ||
      analysisData.ai ||
      aiLoading ||
      aiError
    ) {
      return;
    }

    const controller = new AbortController();
    aiAbort.current = controller;
    void loadAiAnalysis(nameFromPath, controller.signal);
    // Do not abort in cleanup when deps like aiLoading change - that was
    // cancelling the request and leaving aiLoading stuck true.
  }, [
    aiPrefReady,
    aiEnabled,
    nameFromPath,
    analysisData,
    loading,
    aiLoading,
    aiError,
    loadAiAnalysis,
  ]);

  useEffect(() => {
    if (!features.chartsTab || !chartsOpened) return;
    const name = analysisData?.packageInfo?.name;
    if (!name) return;
    const controller = new AbortController();
    fetch(
      `${apiPaths.packages.charts}?package=${encodeURIComponent(name)}&series=issues&ecosystem=${ecosystem}`,
      { signal: controller.signal },
    ).catch(() => {});
    return () => controller.abort();
  }, [
    analysisData?.packageInfo?.name,
    ecosystem,
    features.chartsTab,
    chartsOpened,
  ]);

  const loadVersionSecurity = useCallback(
    async (
      pkgName: string,
      version: string,
      reuseLatestSecurity?: SecuritySummary,
    ) => {
      const cacheKey = `${pkgName}@${version}`;
      if (checkedVersionRef.current === cacheKey) {
        return;
      }

      const latest = analysisData?.packageInfo?.latestVersion;
      if (latest && version === latest && reuseLatestSecurity) {
        setVersionSecurityData({ security: reuseLatestSecurity });
        checkedVersionRef.current = cacheKey;
        setVersionSecurityLoading(false);
        return;
      }

      const requestId = ++versionCheckRequestId.current;
      versionCheckAbort.current?.abort();
      const controller = new AbortController();
      versionCheckAbort.current = controller;
      setVersionSecurityLoading(true);
      setVersionSecurityData(null);
      try {
        const { ok, data } = await fetchJson<
          VersionSecurityPayload & ApiErrorBody
        >(
          `${apiPaths.packages.security}?package=${encodeURIComponent(pkgName)}&version=${encodeURIComponent(version)}&ecosystem=${ecosystem}`,
          {
            signal: controller.signal,
            timeoutMs: 45_000,
            retries: 3,
          },
        );
        if (requestId !== versionCheckRequestId.current) return;
        if (!ok) throw new Error(data.error || "Failed to check security");
        setVersionSecurityData(data);
        checkedVersionRef.current = cacheKey;
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (requestId !== versionCheckRequestId.current) return;
        setVersionSecurityData({ error: friendlyFetchError(err) });
        checkedVersionRef.current = null;
      } finally {
        if (requestId === versionCheckRequestId.current) {
          setVersionSecurityLoading(false);
        }
      }
    },
    [analysisData?.packageInfo?.latestVersion, ecosystem],
  );

  useEffect(() => {
    if (insightTab !== "security") return;
    const pkgName = analysisData?.packageInfo?.name;
    const version = versionToCheck.trim();
    if (!pkgName || !version) return;

    const time = analysisData?.npm?.time as Record<string, string> | undefined;
    const published =
      Boolean(time?.[version]) &&
      !["created", "modified", "unpublished"].includes(version);
    if (time && !published) {
      setVersionSecurityData({ error: "Version not found" });
      setVersionSecurityLoading(false);
      return;
    }

    const latest = analysisData.packageInfo?.latestVersion;
    const canReuse =
      version === latest && analysisData.security
        ? analysisData.security
        : undefined;

    void loadVersionSecurity(pkgName, version, canReuse);
  }, [
    insightTab,
    versionToCheck,
    analysisData?.packageInfo?.name,
    analysisData?.packageInfo?.latestVersion,
    analysisData?.security,
    analysisData?.npm?.time,
    loadVersionSecurity,
  ]);

  const availableVersions = analysisData?.npm?.time
    ? (ecosystem === "pypi"
        ? listStablePypiVersions(analysisData.npm.time)
        : ecosystem === "nuget"
          ? listStableNugetVersions(analysisData.npm.time)
          : Object.keys(analysisData.npm.time)
              .filter((k) => !["created", "modified", "unpublished"].includes(k))
              .filter((v) => Boolean(semver.valid(v)) && !semver.prerelease(v))
              .sort((a, b) => semver.compare(b, a))
      ).slice(0, 10)
    : [];

  // Ensure latest is in the selector list even if filtered out
  const securityVersions = (() => {
    const latest = analysisData?.packageInfo?.latestVersion;
    if (!latest || latest === "Unknown") return availableVersions;
    if (availableVersions.includes(latest)) return availableVersions;
    return [latest, ...availableVersions];
  })();

  // Metrics can return well before the AI request. Hold every section until
  // both are settled so the page does not fill in piece by piece.
  const awaitingAi = aiEnabled && aiLoading && !aiError;
  const reportLoading = loading || awaitingAi;
  const showResults = Boolean(nameFromPath);
  useShellSearchLoading(loading);
  const { updateSummary } = useWatchlistActions();

  const packageDisplayName =
    analysisData?.packageInfo?.name ?? nameFromPath;
  const watchSummary = analysisData
    ? summaryFromAnalysis(analysisData)
    : undefined;
  const serviceStarting = isServiceStartingError(error);

  useEffect(() => {
    if (!packageDisplayName || !analysisData || reportLoading) return;
    updateSummary(
      packageDisplayName,
      summaryFromAnalysis(analysisData),
      ecosystem,
    );
  }, [packageDisplayName, analysisData, reportLoading, updateSummary, ecosystem]);

  return (
    <>
          {serviceStarting ? (
            <ServiceStartingNotice />
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 sm:p-4 mb-4 sm:mb-8">
              <p className="text-red-800 dark:text-red-200">{error}</p>
              {nameFromPath && (
                <button
                  type="button"
                  onClick={() => loadAnalysis(nameFromPath, aiEnabled)}
                  className="mt-3 text-sm font-medium text-red-800 dark:text-red-200 underline hover:no-underline"
                >
                  Try again
                </button>
              )}
            </div>
          ) : null}

          {showResults && (
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
              <PackageNameHeader
                packageName={
                  analysisData?.packageInfo?.name ?? packageDisplayName
                }
                homepage={analysisData?.packageInfo?.homepage}
              />
              <div className="hidden sm:block shrink-0">
                <WatchToggle
                  packageName={packageDisplayName}
                  ecosystem={ecosystem}
                  summary={watchSummary}
                  disabled={!packageDisplayName}
                />
              </div>
            </div>
          )}

          {showResults && !serviceStarting && (
            <div className="space-y-4 sm:space-y-6 mb-4 sm:mb-8">
              <OverviewTabs
                active={overviewTab}
                onChange={handleOverviewTabChange}
                showCharts={features.chartsTab}
              />

              {overviewTab === "info" && (
                <AnalysisPanel id="overview-panel-info" title="Package info">
                  {reportLoading || !analysisData?.packageInfo ? (
                    <PanelSkeleton label="Loading package info" />
                  ) : (
                    <PackageInfoCard
                      packageInfo={analysisData.packageInfo}
                      ecosystem={ecosystem}
                      metrics={analysisData.metrics}
                      metricsLoading={!analysisData.metrics}
                      versionTimes={analysisData.npm?.time}
                      latestSecurity={analysisData.security}
                    />
                  )}
                </AnalysisPanel>
              )}

              {features.chartsTab && overviewTab === "charts" && (
                <AnalysisPanel id="overview-panel-charts" title="Charts">
                  {reportLoading || !analysisData?.packageInfo ? (
                    <PanelSkeleton label="Loading charts" />
                  ) : (
                    <MetricsChartsCard
                      packageName={analysisData.packageInfo.name}
                      ecosystem={ecosystem}
                      showDownloads={features.downloadCharts}
                      repository={analysisData.packageInfo.repository}
                      versionTimes={analysisData.npm?.time}
                      keywords={analysisData.npm?.keywords}
                      competitors={
                        aiEnabled ? analysisData.ai?.competitors : undefined
                      }
                    />
                  )}
                </AnalysisPanel>
              )}

              {overviewTab === "dependencies" && (
                <AnalysisPanel
                  id="overview-panel-dependencies"
                  title="Dependencies"
                >
                  {reportLoading || !analysisData?.packageInfo ? (
                    <PanelSkeleton label="Loading dependencies" />
                  ) : (
                    <DependenciesCard
                      packageName={analysisData.packageInfo.name}
                      ecosystem={ecosystem}
                    />
                  )}
                </AnalysisPanel>
              )}

              <div
                className="border-t border-rule"
                role="separator"
                aria-hidden="true"
              />

              <InsightTabs
                active={insightTab}
                onChange={handleInsightTabChange}
                aiModel={reportLoading ? undefined : analysisData?.ai?.model}
                security={reportLoading ? undefined : analysisData?.security}
                showAi={aiPrefReady && aiEnabled}
                showRelated={features.relatedPackages && aiEnabled}
              />

              {aiPrefReady && aiEnabled && insightTab === "ai" && (
                <AnalysisPanel id="insights-panel-ai" title="AI analysis">
                <div className="space-y-4 sm:space-y-6">
                  {reportLoading || !analysisData?.ai ? (
                    aiError && !aiLoading ? (
                      isServiceStartingError(aiError) ? (
                        <ServiceStartingNotice />
                      ) : (
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
                          <p className="text-gray-600 dark:text-gray-400">
                            AI analysis could not be completed. Please try again.
                          </p>
                          {nameFromPath && (
                            <button
                              type="button"
                              onClick={() => {
                                aiAbort.current?.abort();
                                const controller = new AbortController();
                                aiAbort.current = controller;
                                void loadAiAnalysis(nameFromPath, controller.signal);
                              }}
                              className="link mt-3 text-sm font-medium"
                            >
                              Try again
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      <AIAnalysisSkeleton />
                    )
                  ) : (
                    <AIAnalysisCard ai={analysisData.ai} />
                  )}
                </div>
                </AnalysisPanel>
              )}

              {insightTab === "security" && (
                <AnalysisPanel id="insights-panel-security" title="Security">
                {reportLoading || !analysisData?.packageInfo ? (
                  <PanelSkeleton label="Loading security" />
                ) : (
                  <SecurityCard
                    packageName={analysisData.packageInfo.name}
                    latestVersion={analysisData.packageInfo.latestVersion}
                    availableVersions={securityVersions}
                    versionTimes={analysisData.npm?.time}
                    selectedVersion={versionToCheck}
                    onVersionChange={(v) => {
                      checkedVersionRef.current = null;
                      setVersionToCheck(v);
                    }}
                    securityLoading={versionSecurityLoading}
                    securityData={versionSecurityData}
                  />
                )}
                </AnalysisPanel>
              )}

              {features.relatedPackages &&
                insightTab === "related" &&
                aiEnabled && (
                <AnalysisPanel
                  id="insights-panel-related"
                  title="Related packages"
                >
                {reportLoading || !analysisData ? (
                  <PanelSkeleton label="Loading related packages" />
                ) : (
                  <SimilarPackagesCard
                    packageName={analysisData.packageInfo?.name ?? nameFromPath}
                    ecosystem={ecosystem}
                    keywords={analysisData.npm?.keywords}
                    competitors={
                      aiEnabled ? analysisData.ai?.competitors : undefined
                    }
                    current={snapshotFromAnalysis(
                      analysisData,
                      analysisData.packageInfo?.name ?? nameFromPath,
                    )}
                  />
                )}
                </AnalysisPanel>
              )}
            </div>
          )}

          {!showResults && <WhatWeCheck level={1} />}
    </>
  );
}
