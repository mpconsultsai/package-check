// Type definitions for package data from various sources

import type { SecuritySummary } from '../data-fetchers/security';
import type { BundleSizeInfo } from '../data-fetchers/bundlephobia';
import type { DistributionSizeInfo } from '../data-fetchers/pypi-distribution-size';
import type { InstallScript } from "../packages/install-scripts";
import type { NpmModuleFormat } from "../packages/npm-package-facts";
import type { PackageEcosystem } from "../packages/package-routes";

export type { PackageEcosystem };

export interface NpmPackageData {
  name: string;
  version: string;
  description: string;
  author?: string | { name: string; email?: string };
  license?: string;
  /** Present when the latest version is marked deprecated on npm */
  deprecated?: string | null;
  repository?: {
    type: string;
    url: string;
    /** Monorepo package path when present (e.g. packages/graphql-yoga) */
    directory?: string;
  };
  homepage?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  /** npm lifecycle scripts that run during install. */
  installScripts?: InstallScript[];
  /** package.json browser field (string map or entry) */
  browser?: unknown;
  /** package.json bin */
  bin?: unknown;
  engines?: Record<string, string> | null;
  /** NuGet target frameworks declared for the latest stable version. */
  supportedFrameworks?: string[];
  /** Types listed under "Commonly Used Types" in a NuGet description. */
  commonlyUsedTypes?: string[];
  /** Short note that followed the NuGet type list. */
  descriptionNote?: string | null;
  /** package.json exports */
  exports?: unknown;
  /** CommonJS, ESM, or both, for the latest version. */
  moduleFormat?: NpmModuleFormat;
  /** True when the latest version publishes TypeScript declarations. */
  typesIncluded?: boolean;
  /** When this package is `@types/*`, the package those definitions support. */
  typesFor?: string | null;
  /** DefinitelyTyped package that publishes types when this package does not. */
  typesPackage?: string | null;
  maintainers?: Array<{ name: string; email: string }>;
  time?: {
    created: string;
    modified: string;
    [version: string]: string;
  };
  distTags?: {
    latest: string;
    [tag: string]: string;
  };
}

export interface NpmDownloadStats {
  downloads: number;
  start: string;
  end: string;
  package: string;
  /** NuGet reports a lifetime total. npm reports a monthly window. */
  period?: "month" | "total";
}

export interface GitHubRepoData {
  name: string;
  full_name: string;
  description: string;
  stars: number;
  watchers: number;
  forks: number;
  open_issues: number;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  language: string;
  license?: {
    name: string;
    spdx_id: string;
  };
  topics?: string[];
  has_issues: boolean;
  has_wiki: boolean;
  archived: boolean;
  default_branch: string;
}

export interface GitHubReleaseData {
  tag_name: string;
  name: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  /** Release notes markdown when fetched with body */
  body?: string | null;
  html_url?: string;
}

export interface NpmPackagePopularity {
  dependents: number;
  popularityScore: number;
  qualityScore: number;
  maintenanceScore: number;
}

export interface PackageAnalysisResult {
  packageName: string;
  ecosystem?: PackageEcosystem;
  npm?: NpmPackageData;
  downloads?: NpmDownloadStats;
  github?: GitHubRepoData;
  releases?: GitHubReleaseData[];
  security?: SecuritySummary;
  popularity?: NpmPackagePopularity;
  bundleSize?: BundleSizeInfo | null;
  distributionSize?: DistributionSizeInfo | null;
  readme?: string | null;
  errors?: {
    npm?: string;
    github?: string;
    security?: string;
    ai?: string;
    bundleSize?: string;
  };
}
