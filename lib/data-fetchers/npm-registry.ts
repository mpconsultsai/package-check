import axios from 'axios';
import { listInstallScripts } from "@/lib/packages/install-scripts";
import {
  classifyNpmModuleFormat,
  definitelyTypedPackageName,
  isNpmTypesPackage,
  npmTypesIncluded,
  publishedTypesPresent,
  typesPackageTarget,
} from "@/lib/packages/npm-package-facts";
import {
  emptyNpmProvenance,
  findPriorAttestedVersion,
  npmAttestationsUrl,
  npmHasProvenanceAttestation,
  provenanceFromAttestationDocument,
  type NpmProvenance,
} from "@/lib/packages/npm-provenance";
import { assessNpmPublishRisk } from "@/lib/packages/npm-publish-risk";
import {
  errorMessage,
  publicRegistryMessage,
} from '@/lib/utils/error-message';
import { sanitizeDescription } from '../packages/sanitize';
import { extractPackageName, validatePackageName } from '../packages/validation';
import type { NpmPackageData, NpmDownloadStats } from '../types/package-data';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const NPM_DOWNLOADS_URL = 'https://api.npmjs.org/downloads';

function normalizeRepository(
  raw: unknown,
): NpmPackageData["repository"] | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    return { type: "git", url: raw };
  }
  if (typeof raw === "object" && raw !== null && "url" in raw) {
    const obj = raw as { type?: string; url?: unknown; directory?: unknown };
    if (typeof obj.url !== "string" || !obj.url.trim()) return undefined;
    return {
      type: typeof obj.type === "string" ? obj.type : "git",
      url: obj.url,
      ...(typeof obj.directory === "string" && obj.directory.trim()
        ? { directory: obj.directory.trim().replace(/^\/+|\/+$/g, "") }
        : {}),
    };
  }
  return undefined;
}

/**
 * Fetch package metadata from npm registry (single packument GET).
 * Also returns a truncated README excerpt when present on the packument.
 */
export async function fetchNpmPackageData(packageName: string): Promise<{
  data: NpmPackageData;
  readme: string | null;
}> {
  try {
    const response = await axios.get(`${NPM_REGISTRY_URL}/${packageName}`);
    const data = response.data;
    
    const latestVersion = data['dist-tags']?.latest || Object.keys(data.versions || {}).pop();
    const latestVersionData = data.versions?.[latestVersion] || {};

    const readmeRaw = typeof data.readme === "string" ? data.readme : null;
    // Top of README usually has purpose + deprecation notices; keep prompt lean
    const readme = readmeRaw ? readmeRaw.substring(0, 2000) : null;

    const packageId = typeof data.name === "string" ? data.name : packageName;
    const provenancePromise = resolveNpmProvenance(latestVersionData?.dist);
    const declaredTypes = npmTypesIncluded(latestVersionData);
    const typesFor = typesPackageTarget(packageId);
    let typesIncluded = declaredTypes;
    let typesPackage: string | null = null;
    if (!declaredTypes && typeof latestVersion === "string" && latestVersion) {
      const [published, separate] = await Promise.all([
        fetchPublishedTypes(packageId, latestVersion),
        fetchSeparateTypesPackage(packageId),
      ]);
      if (published === true) typesIncluded = true;
      else if (published === false) typesPackage = separate;
    }
    const provenanceBase = await provenancePromise;
    const priorAttestedVersion =
      typeof latestVersion === "string" && latestVersion && !provenanceBase.verified
        ? findPriorAttestedVersion({
            latestVersion,
            versions: data.versions,
            versionTimes: data.time,
          })
        : null;
    const provenance: NpmProvenance = {
      ...provenanceBase,
      priorAttestedVersion,
    };
    const publishRisk = assessNpmPublishRisk({
      createdAt:
        typeof data.time?.created === "string" ? data.time.created : null,
      maintainers: data.maintainers,
      latestVersion: typeof latestVersion === "string" ? latestVersion : "",
      versions: data.versions,
      versionTimes: data.time,
    });

    return {
      data: {
        name: data.name,
        version: latestVersion,
        description: sanitizeDescription(latestVersionData.description || data.description),
        author: latestVersionData.author,
        license: latestVersionData.license,
        deprecated:
          typeof latestVersionData.deprecated === "string"
            ? latestVersionData.deprecated
            : latestVersionData.deprecated
              ? "This package has been deprecated"
              : null,
        repository: normalizeRepository(
          latestVersionData.repository ?? data.repository,
        ),
        homepage: latestVersionData.homepage,
        keywords: latestVersionData.keywords,
        dependencies: latestVersionData.dependencies,
        peerDependencies: latestVersionData.peerDependencies,
        devDependencies: latestVersionData.devDependencies,
        installScripts: listInstallScripts(latestVersionData.scripts),
        browser: latestVersionData.browser,
        bin: latestVersionData.bin,
        engines:
          latestVersionData.engines &&
          typeof latestVersionData.engines === "object"
            ? latestVersionData.engines
            : null,
        exports: latestVersionData.exports,
        moduleFormat: classifyNpmModuleFormat(latestVersionData),
        typesIncluded,
        typesFor,
        typesPackage,
        provenance,
        maintainers: data.maintainers,
        publishRiskNotes: publishRisk.notes,
        time: data.time,
        distTags: data["dist-tags"],
      },
      readme,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw new Error(`Package "${packageName}" not found on npm registry`);
    }
    if (!(error instanceof Error && /not found/i.test(error.message))) {
      console.error("Failed to fetch npm data:", error);
    }
    throw new Error(publicRegistryMessage(error, "npm"));
  }
}

/**
 * TypeScript also pairs a resolved JavaScript file with a sibling `.d.ts`
 * when package.json never sets `types`. A failed listing leaves the
 * package.json result in place.
 */
async function fetchPublishedTypes(
  packageName: string,
  version: string,
): Promise<boolean | null> {
  try {
    const response = await axios.get(
      `https://data.jsdelivr.com/v1/packages/npm/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`,
      {
        timeout: 4_000,
        params: { structure: "flat" },
        validateStatus: (status) => status === 200 || status === 404,
      },
    );
    if (response.status !== 200 || !Array.isArray(response.data?.files)) {
      return null;
    }
    const names = response.data.files.flatMap((file: { name?: unknown }) =>
      typeof file?.name === "string" ? [file.name] : [],
    );
    return publishedTypesPresent(names);
  } catch {
    return null;
  }
}

/**
 * Signed provenance for this version. A failed detail lookup still counts
 * as verified when the registry already recorded the attestation.
 */
async function resolveNpmProvenance(dist: unknown): Promise<NpmProvenance> {
  if (!npmHasProvenanceAttestation(dist)) return emptyNpmProvenance();
  const url = npmAttestationsUrl(dist);
  if (!url) {
    return { verified: true, repositoryUrl: null, commit: null, ref: null };
  }
  try {
    const response = await axios.get(url, {
      timeout: 4_000,
      validateStatus: (status) => status === 200,
    });
    return (
      provenanceFromAttestationDocument(response.data) ?? {
        verified: true,
        repositoryUrl: null,
        commit: null,
        ref: null,
      }
    );
  } catch {
    return { verified: true, repositoryUrl: null, commit: null, ref: null };
  }
}

/** `@types/*` package on the registry, when this package does not ship types. */
async function fetchSeparateTypesPackage(
  packageName: string,
): Promise<string | null> {
  const typesName = definitelyTypedPackageName(packageName);
  if (!typesName) return null;
  try {
    const response = await axios.get(`${NPM_REGISTRY_URL}/${typesName}/latest`, {
      timeout: 4_000,
      validateStatus: (status) => status === 200 || status === 404,
    });
    return response.status === 200 ? typesName : null;
  } catch {
    return null;
  }
}

/**
 * Fetch download statistics for the last 30 days
 */
export async function fetchNpmDownloadStats(packageName: string): Promise<NpmDownloadStats> {
  try {
    const response = await axios.get(
      `${NPM_DOWNLOADS_URL}/point/last-month/${packageName}`
    );
    return response.data;
  } catch (error: unknown) {
    throw new Error(`Failed to fetch download stats: ${errorMessage(error)}`);
  }
}

/**
 * Daily download counts for up to the last two years.
 * npm caps a single range request at ~365 days, so this uses two ranges.
 * Leading zero-download days are dropped so newer packages start when
 * they first appear in the registry stats.
 */
export interface NpmDownloadDay {
  day: string;
  downloads: number;
}

export async function fetchNpmDownloadTrends(packageName: string): Promise<{
  downloads: NpmDownloadDay[];
}> {
  try {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    // Exclude the most recent two weeks - current/partial weeks are noisy.
    end.setUTCDate(end.getUTCDate() - 14);
    const mid = new Date(end);
    mid.setUTCDate(mid.getUTCDate() - 365);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 730);

    const toIso = (d: Date) => d.toISOString().slice(0, 10);
    const encoded = encodeURIComponent(packageName);
    const ranges = [
      `${toIso(start)}:${toIso(mid)}`,
      `${toIso(mid)}:${toIso(end)}`,
    ];

    const responses = await Promise.all(
      ranges.map((range) =>
        axios.get(`${NPM_DOWNLOADS_URL}/range/${range}/${encoded}`, {
          timeout: 15_000,
          validateStatus: (status) => status === 200 || status === 404,
        }),
      ),
    );

    const byDay = new Map<string, number>();
    for (const response of responses) {
      if (response.status !== 200) continue;
      const days = Array.isArray(response.data?.downloads)
        ? response.data.downloads
        : [];
      for (const entry of days) {
        if (typeof entry?.day !== "string") continue;
        const value =
          typeof entry.downloads === "number" ? entry.downloads : 0;
        byDay.set(entry.day, value);
      }
    }

    const downloads = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, downloads: value }));

    const firstActive = downloads.findIndex((d) => d.downloads > 0);
    return {
      downloads: firstActive >= 0 ? downloads.slice(firstActive) : downloads,
    };
  } catch (error: unknown) {
    throw new Error(`Failed to fetch download trends: ${errorMessage(error)}`);
  }
}

export interface DownloadChartPoint {
  date: string;
  value: number;
}

export type WeeklyDownloadOptions = {
  /** Days before today excluded (npm default trims incomplete recent weeks). */
  excludeRecentDays?: number;
  /** Minimum daily samples required to count a week (PyPI uses a lower bar). */
  minDaysInWeek?: number;
  /** Drop the newest full week when multiple weeks exist (npm trends convention). */
  dropLastCompleteWeek?: boolean;
};

export function toWeeklyDownloads(
  days: NpmDownloadDay[],
  options?: WeeklyDownloadOptions,
): DownloadChartPoint[] {
  const excludeRecentDays = options?.excludeRecentDays ?? 14;
  const minDaysInWeek = options?.minDaysInWeek ?? 7;
  const dropLastCompleteWeek = options?.dropLastCompleteWeek ?? true;

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - excludeRecentDays);
  const cutoff = end.toISOString().slice(0, 10);
  const byWeek = new Map<string, { total: number; days: number }>();

  for (const day of days) {
    if (!day.day || day.day > cutoff) continue;
    const date = new Date(`${day.day}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    // Align weeks to Monday UTC so series from different packages share dates.
    const dayIndex = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayIndex);
    const weekKey = date.toISOString().slice(0, 10);
    const bucket = byWeek.get(weekKey) ?? { total: 0, days: 0 };
    bucket.total += day.downloads || 0;
    bucket.days += 1;
    byWeek.set(weekKey, bucket);
  }

  // Drop partial weeks at the start/end - they look like false dips.
  const weeks = [...byWeek.entries()]
    .filter(([, bucket]) => bucket.days >= minDaysInWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({ date, value: bucket.total }));

  if (dropLastCompleteWeek && weeks.length > 1) {
    return weeks.slice(0, -1);
  }
  return weeks;
}

export function toDailyDownloadChartPoints(
  days: NpmDownloadDay[],
): DownloadChartPoint[] {
  return days
    .filter(
      (day) =>
        typeof day.day === "string" &&
        day.day.length > 0 &&
        typeof day.downloads === "number",
    )
    .map((day) => ({ date: day.day, value: day.downloads }));
}

export type DownloadChartGranularity = "week" | "day";

/** Chart-ready download series; PyPI short histories fall back to daily points. */
export function aggregateDownloadsForCharts(
  days: NpmDownloadDay[],
  ecosystem: "npm" | "pypi",
): { points: DownloadChartPoint[]; granularity: DownloadChartGranularity } {
  if (ecosystem === "pypi") {
    const weekly = toWeeklyDownloads(days, {
      excludeRecentDays: 0,
      minDaysInWeek: 4,
      dropLastCompleteWeek: false,
    });
    if (weekly.length >= 2) {
      return { points: weekly, granularity: "week" };
    }
    const daily = toDailyDownloadChartPoints(days);
    if (daily.length >= 2) {
      return { points: daily, granularity: "day" };
    }
    if (weekly.length === 1) {
      return { points: weekly, granularity: "week" };
    }
    return { points: daily, granularity: "day" };
  }

  const weekly = toWeeklyDownloads(days);
  if (weekly.length >= 2) {
    return { points: weekly, granularity: "week" };
  }
  const daily = toDailyDownloadChartPoints(days);
  return {
    points: daily.length >= 2 ? daily : weekly,
    granularity: daily.length >= 2 ? "day" : "week",
  };
}

export interface NpmSearchResult {
  name: string;
  description: string;
  version: string;
  score?: number;
  keywords?: string[];
  deprecated?: boolean;
}

/** Well-known packages probed for prefix completion when npm search omits them. */
const WELL_KNOWN_PACKAGES = [
  'angular',
  'react',
  'react-dom',
  'vue',
  'lodash',
  'express',
  'next',
  'typescript',
  'axios',
  'webpack',
  'eslint',
  'rxjs',
  'jquery',
  'prettier',
  'vite',
  'tailwindcss',
  'commander',
  'chalk',
  'mongoose',
  'nodemon',
  '@angular/core',
  '@types/node',
  '@types/react',
];

async function fetchRegistryLatestPackage(
  name: string,
): Promise<(NpmSearchResult & { keywords?: string[]; deprecated?: boolean }) | null> {
  try {
    const response = await axios.get(
      `${NPM_REGISTRY_URL}/${encodeURIComponent(name)}/latest`,
      {
        timeout: 4000,
        validateStatus: (status) => status === 200 || status === 404,
      },
    );
    if (response.status === 404) return null;

    const data = response.data;
    const keywords = Array.isArray(data.keywords)
      ? data.keywords.filter((k: unknown) => typeof k === "string")
      : undefined;
    return {
      name: data.name || name,
      description: sanitizeDescription(data.description) || "No description",
      version: data.version || "",
      score: 1_000_000,
      keywords,
      deprecated: Boolean(data.deprecated),
    };
  } catch {
    return null;
  }
}

export async function fetchNpmPackageCards(
  names: string[],
): Promise<Array<{
  name: string;
  description: string;
  version: string;
  keywords?: string[];
  deprecated?: boolean;
}>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const results = await Promise.all(
    unique.map(async (name) => {
      const card = await fetchRegistryLatestPackage(name);
      if (card && !card.deprecated) return card;
      if (!name.includes("/")) {
        const scopedCore = await fetchRegistryLatestPackage(`@${name}/core`);
        if (scopedCore && !scopedCore.deprecated) return scopedCore;
      }
      return null;
    }),
  );
  return results
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(({ name, description, version, keywords }) => ({
      name,
      description,
      version,
      keywords,
    }));
}

async function fetchExactPackageMatch(query: string): Promise<NpmSearchResult | null> {
  const candidate = extractPackageName(query);
  if (!validatePackageName(candidate).valid) return null;
  const pkg = await fetchRegistryLatestPackage(candidate);
  if (!pkg) return null;
  return { ...pkg, score: 10_000_000 };
}

async function fetchWellKnownPrefixMatches(query: string): Promise<NpmSearchResult[]> {
  const q = query.toLowerCase().trim();
  if (q.length < 2 || q.startsWith('@')) return [];

  const candidates = WELL_KNOWN_PACKAGES.filter((name) => {
    const lower = name.toLowerCase();
    return lower.startsWith(q) && lower !== q;
  }).slice(0, 6);

  if (candidates.length === 0) return [];

  const results = await Promise.all(
    candidates.map((name) => fetchRegistryLatestPackage(name)),
  );
  return results.filter((r): r is NpmSearchResult => r !== null);
}

function pinExactNameFirst(
  results: NpmSearchResult[],
  query: string,
): NpmSearchResult[] {
  const q = query.toLowerCase().trim();
  const exactIndex = results.findIndex((r) => r.name.toLowerCase() === q);
  if (exactIndex <= 0) return results;
  const exact = results[exactIndex];
  return [
    exact,
    ...results.filter((_, index) => index !== exactIndex),
  ];
}

/**
 * Sort search results: exact match → unscoped prefix → scoped → contains → npm score.
 */
export function sortNpmSearchResults(
  query: string,
  results: NpmSearchResult[],
): NpmSearchResult[] {
  const q = query.toLowerCase().trim();
  const queryIsScoped = q.startsWith('@');
  const qSegment = q.includes('/') ? q.split('/').pop()! : q;

  function rank(name: string): number {
    const lower = name.toLowerCase();
    const nameIsScoped = lower.startsWith('@');

    if (lower === q) return 0;

    if (!nameIsScoped && lower.startsWith(q)) return 1;

    if (queryIsScoped) {
      if (lower.startsWith(q)) return 1;
      const segment = lower.split('/')[1] ?? '';
      if (segment.startsWith(qSegment)) return 2;
    }

    // Unscoped query: rank @angular/* below unscoped "angular" and angular-*
    if (!queryIsScoped && nameIsScoped) {
      const [scope, segment] = lower.split('/');
      if (scope === `@${q}` && segment === q) return 2;
      if (segment === q) return 3;
      if (scope === `@${q}`) return 10;
      if (scope.includes(q)) return 11;
      return 12;
    }

    if (nameIsScoped) {
      const segment = lower.split('/')[1] ?? '';
      if (segment.startsWith(qSegment)) return 4;
    }

    if (lower.includes(q)) return 5;
    return 6;
  }

  return [...results].sort((a, b) => {
    const rankDiff = rank(a.name) - rank(b.name);
    if (rankDiff !== 0) return rankDiff;
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (Number.isFinite(scoreDiff) && scoreDiff !== 0) return scoreDiff;
    return a.name.length - b.name.length;
  });
}

/**
 * Search npm registry for packages matching a query (for typeahead).
 */
export async function searchNpmPackages(
  query: string,
  limit: number = 8,
): Promise<NpmSearchResult[]> {
  const text = query.trim();
  if (text.length < 2) return [];

  try {
    const [searchResponse, exactMatch, prefixMatches] = await Promise.all([
      axios.get(`${NPM_REGISTRY_URL}/-/v1/search`, {
        params: { text, size: Math.max(limit * 3, 30) },
      }),
      fetchExactPackageMatch(text),
      fetchWellKnownPrefixMatches(text),
    ]);
    const objects = searchResponse.data?.objects || [];
    const seen = new Set<string>();
    const results: NpmSearchResult[] = [];

    for (const match of [exactMatch, ...prefixMatches]) {
      if (!match) continue;
      const key = match.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(match);
    }

    for (const entry of objects) {
      const mapped = {
        name: entry.package?.name ?? '',
        description:
          sanitizeDescription(entry.package?.description) || 'No description',
        version: entry.package?.version ?? '',
        score: entry.score?.final ?? 0,
      };
      if (!mapped.name || seen.has(mapped.name.toLowerCase())) continue;
      seen.add(mapped.name.toLowerCase());
      results.push(mapped);
    }

    return pinExactNameFirst(
      sortNpmSearchResults(text, results),
      text,
    ).slice(0, limit);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Search failed';
    console.warn('npm package search failed:', message);
    return [];
  }
}

/**
 * Used to identify well-known packages like react, lodash
 */
export async function fetchNpmPackagePopularity(packageName: string): Promise<{
  dependents: number;
  popularityScore: number;
  qualityScore: number;
  maintenanceScore: number;
} | null> {
  try {
    // Search by exact package name - first result should match
    const response = await axios.get(
      `${NPM_REGISTRY_URL}/-/v1/search`,
      { params: { text: packageName, size: 1 } }
    );
    const objects = response.data?.objects || [];
    const match = objects[0];

    if (!match || match.package?.name?.toLowerCase() !== packageName.toLowerCase()) {
      return null;
    }

    return {
      dependents: parseInt(match.dependents || '0', 10) || 0,
      popularityScore: match.score?.detail?.popularity ?? 0,
      qualityScore: match.score?.detail?.quality ?? 0,
      maintenanceScore: match.score?.detail?.maintenance ?? 0,
    };
  } catch (error: unknown) {
    console.warn(
      `Could not fetch npm popularity for ${packageName}:`,
      errorMessage(error),
    );
    return null;
  }
}

const GENERIC_KEYWORDS = new Set([
  "javascript",
  "js",
  "node",
  "nodejs",
  "node.js",
  "npm",
  "library",
  "package",
  "module",
  "util",
  "utils",
  "utility",
  "utilities",
  "helper",
  "helpers",
  "ts",
  "typescript",
  "es6",
  "esm",
  "cjs",
  "browser",
  "frontend",
  "backend",
  "web",
  "html",
  "css",
  "api",
  "sdk",
  "cli",
  "tool",
  "tools",
  "framework",
  "plugin",
  "component",
  "components",
  "app",
  "application",
]);

export function distinctiveKeywords(keywords?: string[] | null): string[] {
  const seen = new Set<string>();
  const distinctive: string[] = [];
  for (const raw of keywords ?? []) {
    const keyword = raw.trim().toLowerCase();
    if (!keyword || GENERIC_KEYWORDS.has(keyword) || seen.has(keyword)) continue;
    seen.add(keyword);
    distinctive.push(keyword);
    if (distinctive.length >= 4) break;
  }
  return distinctive;
}

function nameTokens(packageName: string): string[] {
  const unscoped = packageName.includes("/")
    ? packageName.split("/").pop() ?? packageName
    : packageName;
  return unscoped
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENERIC_KEYWORDS.has(token));
}

export function keywordOverlap(source: string[], candidate: string[] | undefined): number {
  if (!source.length || !candidate?.length) return 0;
  const candidateSet = new Set(candidate.map((k) => k.toLowerCase()));
  let hits = 0;
  for (const keyword of source) {
    if (candidateSet.has(keyword)) hits += 1;
  }
  return hits / source.length;
}

function nameRelatedness(sourceName: string, candidateName: string): number {
  const source = nameTokens(sourceName);
  const candidate = nameTokens(candidateName);
  if (!source.length || !candidate.length) return 0;
  const candidateSet = new Set(candidate);
  let hits = 0;
  for (const token of source) {
    if (candidateSet.has(token)) hits += 1;
  }
  return hits / source.length;
}

async function searchNpmSimilar(text: string, size: number) {
  const response = await axios.get(`${NPM_REGISTRY_URL}/-/v1/search`, {
    params: { text, size },
    timeout: 15_000,
  });
  return response.data?.objects ?? [];
}

export type SimilarPackageCard = {
  name: string;
  description: string;
  version: string;
};

/**
 * Rank related packages by distinctive keyword overlap, name similarity,
 * and npm's quality/popularity/maintenance scores - not raw search order.
 *
 * Returns a ranked pool (default 30) so callers can paginate with an offset cursor.
 */
export async function fetchSimilarPackages(
  packageName: string,
  keywords?: string[] | null,
  limit: number = 30
): Promise<SimilarPackageCard[]> {
  try {
    const distinctive = distinctiveKeywords(keywords);
    const queries = new Set<string>();
    if (distinctive.length) {
      queries.add(distinctive.slice(0, 3).map((k) => `keywords:${k}`).join(" "));
    }
    queries.add(packageName);

    const poolSize = Math.min(Math.max(limit * 2, 24), 50);
    const searches = await Promise.allSettled(
      [...queries].map((text) => searchNpmSimilar(text, poolSize)),
    );

    const currentLower = packageName.toLowerCase();
    const seen = new Set<string>([currentLower]);
    const ranked: Array<SimilarPackageCard & { score: number }> = [];

    for (const result of searches) {
      if (result.status !== "fulfilled") continue;
      for (const entry of result.value) {
        const name = entry.package?.name;
        if (!name || isNpmTypesPackage(name)) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const overlap = keywordOverlap(distinctive, entry.package?.keywords);
        const nameScore = nameRelatedness(packageName, name);
        const npmScore = Number(entry.score?.final) || 0;
        const popularity = Number(entry.score?.detail?.popularity) || 0;
        // Prefer true category overlap over a popular-but-unrelated hit.
        const score = overlap * 4 + nameScore * 2 + npmScore + popularity * 0.5;
        if (score <= 0.15) continue;

        ranked.push({
          name,
          description:
            sanitizeDescription(entry.package?.description) || "No description",
          version: entry.package?.version ?? "",
          score,
        });
      }
    }

    return ranked
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ name, description, version }) => ({ name, description, version }));
  } catch (error: unknown) {
    console.warn("Could not fetch similar packages:", errorMessage(error));
    return [];
  }
}

/**
 * Fetch package README content (truncated for AI analysis).
 * Prefer readme from fetchNpmPackageData when analysing - this is a standalone fallback.
 */
export async function fetchNpmReadme(packageName: string): Promise<string | null> {
  try {
    const { readme } = await fetchNpmPackageData(packageName);
    return readme;
  } catch (error: unknown) {
    console.error(
      `Failed to fetch README for ${packageName}:`,
      errorMessage(error),
    );
    return null;
  }
}
