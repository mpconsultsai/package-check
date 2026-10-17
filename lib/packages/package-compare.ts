import { isConfidentRuntime } from "@/lib/packages/runtime-environment";

export type CompareColumnStatus = "ready" | "loading" | "error";

export interface CompareColumn {
  name: string;
  status: CompareColumnStatus;
  version?: string;
  qualityScore?: number;
  vulnerabilityCount?: number;
  downloads?: number;
  bundleGzip?: number;
  lastRelease?: string | null;
  runtime?: string;
  license?: string;
  error?: string;
}

type AnalysisLike = {
  packageInfo?: {
    name?: string;
    latestVersion?: string;
    license?: string;
    lastReleaseLabel?: string | null;
    runtime?: {
      label?: string;
      kind?: "client" | "server" | "both" | "unclear";
      confidence?: "high" | "medium" | "low";
    };
  };
  metrics?: {
    qualityScore?: number;
    downloads?: number;
    bundleGzip?: number;
  };
  security?: { totalCount?: number };
};

const asAnalysis = (data: unknown): AnalysisLike | null => {
  if (!data || typeof data !== "object") return null;
  return data as AnalysisLike;
};

export const snapshotFromAnalysis = (
  data: unknown,
  fallbackName = "",
): CompareColumn => {
  const analysis = asAnalysis(data);
  const name = analysis?.packageInfo?.name || fallbackName;
  const version = analysis?.packageInfo?.latestVersion;
  return {
    name,
    status: "ready",
    version: version && version !== "Unknown" ? version : undefined,
    qualityScore: analysis?.metrics?.qualityScore,
    vulnerabilityCount: analysis?.security?.totalCount,
    downloads: analysis?.metrics?.downloads,
    bundleGzip: analysis?.metrics?.bundleGzip,
    lastRelease: analysis?.packageInfo?.lastReleaseLabel ?? null,
    runtime: isConfidentRuntime(analysis?.packageInfo?.runtime)
      ? analysis?.packageInfo?.runtime?.label
      : undefined,
    license:
      analysis?.packageInfo?.license && analysis.packageInfo.license !== "Unknown"
        ? analysis.packageInfo.license
        : undefined,
  };
};
