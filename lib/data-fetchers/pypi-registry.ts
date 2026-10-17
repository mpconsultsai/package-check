import axios from "axios";
import { resolvePypiLicense } from "@/lib/packages/license-info";
import {
  pickPypiDistributionSize,
  type DistributionSizeInfo,
} from "@/lib/data-fetchers/pypi-distribution-size";
import { errorMessage } from "@/lib/utils/error-message";
import { validatePackageNameForEcosystem } from "@/lib/packages/validation";
import { sanitizeDescription } from "../packages/sanitize";
import type { NpmPackageData } from "../types/package-data";
import {
  coreDependenciesMap,
  parsePypiRequiresDist,
  type PypiInstallRequirements,
} from "@/lib/pypi/pypi-requires-dist";

const PYPI_JSON_URL = "https://pypi.org/pypi";
const PYPI_SIMPLE_INDEX_URL = "https://pypi.org/simple/";
const SIMPLE_INDEX_CACHE_MS = 24 * 60 * 60 * 1000;
const SIMPLE_INDEX_MAX_BYTES = 55 * 1024 * 1024;

type SimpleIndexCache = {
  names: string[];
  expiresAt: number;
};

let simpleIndexCache: SimpleIndexCache | null = null;
let simpleIndexLoad: Promise<string[]> | null = null;

export type PypiSearchResult = {
  name: string;
  description: string;
  version: string;
};

function buildTimeMap(
  releases: Record<string, { upload_time?: string }[] | undefined> | undefined,
): NpmPackageData["time"] {
  const time: Record<string, string> = {};
  if (releases) {
    for (const [version, files] of Object.entries(releases)) {
      if (!files?.length) continue;
      let latestUpload: string | undefined;
      for (const file of files) {
        const upload = file?.upload_time;
        if (!upload) continue;
        if (
          !latestUpload ||
          new Date(upload).getTime() > new Date(latestUpload).getTime()
        ) {
          latestUpload = upload;
        }
      }
      if (latestUpload) time[version] = latestUpload;
    }
  }
  return time as NpmPackageData["time"];
}

function normalizeRepoUrl(
  projectUrls?: Record<string, string> | null,
  homePage?: string | null,
): NpmPackageData["repository"] | undefined {
  const keyed = projectUrls ?? {};
  const candidates: string[] = [];

  for (const key of [
    "Repository",
    "repository",
    "Source",
    "source",
    "Source Code",
    "Code",
    "GitHub",
    "github",
  ]) {
    const url = keyed[key];
    if (typeof url === "string" && url.trim()) candidates.push(url.trim());
  }

  for (const url of Object.values(keyed)) {
    if (typeof url === "string" && url.trim()) candidates.push(url.trim());
  }

  if (typeof homePage === "string" && homePage.trim()) {
    candidates.push(homePage.trim());
  }

  const githubUrl = candidates.find((url) =>
    /github\.com/i.test(url),
  );
  if (!githubUrl) return undefined;
  return { type: "git", url: githubUrl };
}

export async function fetchPypiPackageData(packageName: string): Promise<{
  data: NpmPackageData;
  readme: string | null;
  distributionSize: DistributionSizeInfo | null;
  pypiInstall: PypiInstallRequirements;
}> {
  try {
    const response = await axios.get(
      `${PYPI_JSON_URL}/${encodeURIComponent(packageName)}/json`,
      { validateStatus: (status) => status === 200 || status === 404 },
    );
    if (response.status === 404) {
      throw new Error(`Project "${packageName}" not found on PyPI`);
    }

    const payload = response.data;
    const info = payload.info ?? {};
    const version =
      typeof info.version === "string" ? info.version : "Unknown";
    const description = sanitizeDescription(
      info.summary || info.description || "",
    );

    const readmeRaw =
      typeof info.description === "string" && info.description.length > 0
        ? info.description
        : null;
    const readme = readmeRaw ? readmeRaw.substring(0, 2000) : null;

    const time = buildTimeMap(payload.releases);
    const distributionSize = pickPypiDistributionSize(
      payload.releases,
      version,
    );

    const pypiInstall = parsePypiRequiresDist(
      info.requires_dist,
      info.provides_extra,
      info.requires_python,
    );

    return {
      data: {
        name: info.name || packageName,
        version,
        description,
        license: resolvePypiLicense({
          license: info.license,
          license_expression: info.license_expression,
          classifiers: info.classifiers,
        }),
        repository: normalizeRepoUrl(info.project_urls, info.home_page),
        homepage: info.home_page || info.project_urls?.Homepage,
        keywords: info.keywords
          ? info.keywords
              .split(",")
              .map((k: string) => k.trim())
              .filter(Boolean)
          : undefined,
        dependencies: coreDependenciesMap(pypiInstall),
        engines: pypiInstall.requiresPython
          ? { python: pypiInstall.requiresPython }
          : null,
        maintainers: undefined,
        time,
        distTags: { latest: version },
      },
      readme,
      distributionSize,
      pypiInstall,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw new Error(`Project "${packageName}" not found on PyPI`);
    }
    throw new Error(`Failed to fetch PyPI data: ${errorMessage(error)}`);
  }
}

function parseSimpleIndexNames(html: string): string[] {
  const names: string[] = [];
  const pattern = /<a href="\/simple\/[^"]+">([^<]*)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const name = match[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

/** PEP 503 simple index (cached). PyPI removed XML-RPC search in 2021. */
async function loadPypiSimpleProjectNames(): Promise<string[]> {
  if (simpleIndexCache && simpleIndexCache.expiresAt > Date.now()) {
    return simpleIndexCache.names;
  }
  if (simpleIndexLoad) return simpleIndexLoad;

  simpleIndexLoad = (async () => {
    const response = await axios.get<string>(PYPI_SIMPLE_INDEX_URL, {
      timeout: 120_000,
      maxContentLength: SIMPLE_INDEX_MAX_BYTES,
      responseType: "text",
      headers: {
          "User-Agent": "pkglens/1.0 (+https://github.com)",
        Accept: "text/html",
      },
    });
    const names = parseSimpleIndexNames(String(response.data));
    simpleIndexCache = {
      names,
      expiresAt: Date.now() + SIMPLE_INDEX_CACHE_MS,
    };
    return names;
  })();

  try {
    return await simpleIndexLoad;
  } finally {
    simpleIndexLoad = null;
  }
}

function scorePypiNameMatch(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 10_000;
  if (n.startsWith(q)) return 5_000 - Math.min(n.length, 500);
  if (q.length >= 3 && n.includes(q)) return 1_000 - Math.min(n.length, 500);
  return 0;
}

function rankPypiNameMatches(names: string[], query: string, cap: number): string[] {
  const ranked: { name: string; score: number }[] = [];
  for (const name of names) {
    const score = scorePypiNameMatch(name, query);
    if (score > 0) ranked.push({ name, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of ranked) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(row.name);
    if (ordered.length >= cap) break;
  }
  return ordered;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function enrichPypiSearchCandidates(
  names: string[],
  limit: number,
): Promise<PypiSearchResult[]> {
  const enriched = await mapPool(names, 4, async (name) => {
    try {
      const { data } = await fetchPypiPackageData(name);
      return {
        name: data.name,
        description: data.description || "No description",
        version: data.version,
      } satisfies PypiSearchResult;
    } catch {
      return null;
    }
  });

  return enriched.filter((row): row is PypiSearchResult => row !== null).slice(0, limit);
}

export async function searchPypiPackages(
  query: string,
  limit: number = 8,
): Promise<PypiSearchResult[]> {
  const text = query.trim();
  if (text.length < 2) return [];

  const exactPromise =
    validatePackageNameForEcosystem(text, "pypi").valid
      ? fetchPypiPackageData(text).catch(() => null)
      : Promise.resolve(null);

  let indexNames: string[] = [];
  try {
    indexNames = await loadPypiSimpleProjectNames();
  } catch {
    indexNames = [];
  }

  const exact = await exactPromise;
  const seen = new Set<string>();
  const orderedNames: string[] = [];

  if (exact?.data.name) {
    seen.add(exact.data.name.toLowerCase());
    orderedNames.push(exact.data.name);
  }

  if (indexNames.length > 0) {
    for (const name of rankPypiNameMatches(indexNames, text, limit * 4)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      orderedNames.push(name);
      if (orderedNames.length >= limit * 3) break;
    }
  }

  if (orderedNames.length === 0) {
    return [];
  }

  if (orderedNames.length === 1 && exact?.data.name) {
    return [
      {
        name: exact.data.name,
        description: exact.data.description || "No description",
        version: exact.data.version,
      },
    ];
  }

  const enriched = await enrichPypiSearchCandidates(orderedNames, limit);
  if (enriched.length > 0) return enriched;

  if (exact?.data.name) {
    return [
      {
        name: exact.data.name,
        description: exact.data.description || "No description",
        version: exact.data.version,
      },
    ];
  }
  return [];
}
