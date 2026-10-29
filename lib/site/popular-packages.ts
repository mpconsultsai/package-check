import axios from "axios";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { isDotnetInboxPackageId } from "@/lib/nuget/dotnet-platform";
import { validatePackageNameForEcosystem } from "@/lib/packages/validation";
import {
  EXAMPLE_PACKAGES,
  MAVEN_POPULAR_PACKAGES,
} from "@/lib/site/example-packages";

const TOP_COUNT = 100;
/** NuGet's first page is mostly Microsoft.* and System.*. Read further so 100 others remain. */
const NUGET_FETCH_COUNT = 1000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const NPM_TOP_DOWNLOADS_URL =
  "https://unpkg.com/npm-high-impact@1/lib/top-download.js";
const PYPI_TOP_DOWNLOADS_URL =
  "https://hugovk.dev/top-pypi-packages/top-pypi-packages-30-days.min.json";
const NUGET_SEARCH_URL = "https://azuresearch-usnc.nuget.org/query";

const HEADERS = {
  Accept: "application/json, text/javascript;q=0.9",
  "User-Agent": "pkglens/1.0",
};

export const POPULAR_EXAMPLE_COUNT = 3;

type RankingCache = { names: string[]; expiresAt: number };

const caches = new Map<PackageEcosystem, RankingCache>();
const loads = new Map<PackageEcosystem, Promise<string[]>>();

/** Distinct names drawn from a download ranking. */
export function pickExamplePackages(
  names: readonly string[],
  count = POPULAR_EXAMPLE_COUNT,
  random: () => number = Math.random,
): string[] {
  const pool = [...names];
  const picked: string[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.min(
      pool.length - 1,
      Math.floor(random() * pool.length),
    );
    const name = pool.splice(index, 1)[0];
    if (name) picked.push(name);
  }
  return picked;
}

function acceptedName(
  name: string,
  ecosystem: PackageEcosystem,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (!validatePackageNameForEcosystem(trimmed, ecosystem).valid) return null;
  if (ecosystem === "npm" && /^@types(\/|$)/i.test(trimmed)) return null;
  if (ecosystem === "nuget" && isDotnetInboxPackageId(trimmed)) return null;
  return trimmed;
}

/** Quoted names from the npm-high-impact top-download module, most downloaded first. */
export function namesFromNpmTopDownloads(
  source: string,
  limit = TOP_COUNT,
): string[] {
  const names: string[] = [];
  const pattern = /'((?:\\'|[^'])*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null && names.length < limit) {
    const name = acceptedName(match[1].replace(/\\'/g, "'"), "npm");
    if (name) names.push(name);
  }
  return names;
}

/** Projects from the PyPI top-packages dataset, most downloaded first. */
export function namesFromPypiTopDownloads(
  payload: unknown,
  limit = TOP_COUNT,
): string[] {
  const rows = (payload as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  const names: string[] = [];
  for (const row of rows) {
    if (names.length >= limit) break;
    const project = (row as { project?: unknown }).project;
    if (typeof project !== "string") continue;
    const name = acceptedName(project, "pypi");
    if (name) names.push(name);
  }
  return names;
}

/** Package ids from a NuGet search page, highest total downloads first. */
export function namesFromNugetSearch(
  payload: unknown,
  limit = TOP_COUNT,
): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      const record = item as { id?: unknown; totalDownloads?: unknown };
      const name = typeof record.id === "string" ? record.id : "";
      const downloads =
        typeof record.totalDownloads === "number" ? record.totalDownloads : 0;
      return { name: acceptedName(name, "nuget"), downloads };
    })
    .filter((item): item is { name: string; downloads: number } =>
      Boolean(item.name),
    )
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, limit)
    .map((item) => item.name);
}

async function fetchRanking(ecosystem: PackageEcosystem): Promise<string[]> {
  if (ecosystem === "npm") {
    const response = await axios.get<string>(NPM_TOP_DOWNLOADS_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: "text",
      maxContentLength: 2_000_000,
      headers: HEADERS,
    });
    return namesFromNpmTopDownloads(String(response.data));
  }
  if (ecosystem === "pypi") {
    const response = await axios.get(PYPI_TOP_DOWNLOADS_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: 8_000_000,
      headers: HEADERS,
    });
    return namesFromPypiTopDownloads(response.data);
  }
  if (ecosystem === "maven") {
    // Central has no public top-downloads feed; sample a curated popular set.
    return MAVEN_POPULAR_PACKAGES.filter(
      (name) => acceptedName(name, "maven") !== null,
    ).slice(0, TOP_COUNT);
  }
  const response = await axios.get(NUGET_SEARCH_URL, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: HEADERS,
    params: { take: NUGET_FETCH_COUNT, prerelease: false },
  });
  return namesFromNugetSearch(response.data);
}

/** Top downloaded package names for one registry. Cached for a day. */
export async function topDownloadedPackages(
  ecosystem: PackageEcosystem,
): Promise<string[]> {
  const cached = caches.get(ecosystem);
  if (cached && cached.expiresAt > Date.now()) return cached.names;

  const pending = loads.get(ecosystem);
  if (pending) return pending;

  const load = (async () => {
    const names = await fetchRanking(ecosystem);
    if (names.length === 0) {
      throw new Error(`No popular ${ecosystem} packages`);
    }
    caches.set(ecosystem, {
      names,
      expiresAt: Date.now() + CACHE_MS,
    });
    return names;
  })();
  loads.set(ecosystem, load);
  try {
    return await load;
  } finally {
    loads.delete(ecosystem);
  }
}

/**
 * Three packages chosen at random from that registry's top downloads.
 * Falls back to the fixed examples when the ranking cannot be loaded.
 */
export async function randomPopularPackages(
  ecosystem: PackageEcosystem,
  count = POPULAR_EXAMPLE_COUNT,
): Promise<string[]> {
  try {
    const picked = pickExamplePackages(
      await topDownloadedPackages(ecosystem),
      count,
    );
    if (picked.length > 0) return picked;
  } catch (error: unknown) {
    console.error(`Failed to load popular ${ecosystem} packages:`, error);
  }
  return [...EXAMPLE_PACKAGES[ecosystem]].slice(0, count);
}
