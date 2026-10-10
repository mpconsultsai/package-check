import axios from "axios";
import { errorMessage } from "@/lib/utils/error-message";
import { validatePackageNameForEcosystem } from "@/lib/validation";
import { sanitizeDescription } from "@/lib/sanitize";
import { formatNugetDescription } from "@/lib/nuget-description";
import type { NpmPackageData } from "@/lib/types/package-data";
import type { DistributionSizeInfo } from "@/lib/data-fetchers/pypi-distribution-size";
import {
  compareNugetVersions,
  isNugetPrerelease,
} from "@/lib/nuget-version";
import { isDotnetInboxPackageId } from "@/lib/dotnet-platform";

const REGISTRATION =
  "https://api.nuget.org/v3/registration5-gz-semver2";
const FLAT_CONTAINER = "https://api.nuget.org/v3-flatcontainer";
const SEARCH_URL = "https://azuresearch-usnc.nuget.org/query";

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "pkglens/1.0",
};

export type NugetSearchResult = {
  name: string;
  description: string;
  version: string;
};

type NugetDependency = { id?: string; range?: string };

type NugetDependencyGroup = {
  targetFramework?: string;
  dependencies?: NugetDependency[];
};

type CatalogEntry = {
  id?: string;
  version?: string;
  description?: string;
  summary?: string;
  authors?: string;
  published?: string;
  projectUrl?: string;
  licenseExpression?: string;
  licenseUrl?: string;
  tags?: string | string[];
  listed?: boolean;
  dependencyGroups?: NugetDependencyGroup[];
};

type RegistrationLeaf = { catalogEntry?: CatalogEntry };

type RegistrationPage = {
  "@id"?: string;
  items?: RegistrationLeaf[];
};

function idPath(id: string): string {
  return encodeURIComponent(id.trim().toLowerCase());
}

function versionPath(version: string): string {
  return encodeURIComponent(version.trim().toLowerCase());
}

async function getJson<T>(url: string): Promise<{ status: number; data: T }> {
  const response = await axios.get<T>(url, {
    headers: HEADERS,
    validateStatus: (status) => status === 200 || status === 404,
  });
  return { status: response.status, data: response.data };
}

function frameworkRank(targetFramework: string | undefined): number {
  const key = (targetFramework ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const preferred = [
    "net10",
    "net9",
    "net8",
    "net7",
    "net6",
    "netstandard21",
    "netstandard20",
    "netstandard",
    "net5",
    "netcoreapp",
  ];
  const index = preferred.findIndex((item) => key.startsWith(item));
  if (!targetFramework) return 50;
  if (index === -1) return 0;
  return preferred.length - index;
}

function listSupportedFrameworks(
  groups: NugetDependencyGroup[] | undefined,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const group of groups ?? []) {
    const name = group.targetFramework?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

async function fetchNugetTotalDownloads(
  packageId: string,
): Promise<number | null> {
  try {
    const response = await axios.get<{
      data?: { id?: string; totalDownloads?: number }[];
    }>(SEARCH_URL, {
      headers: HEADERS,
      params: {
        q: `packageid:${packageId}`,
        take: 5,
        prerelease: false,
      },
    });
    const want = packageId.toLowerCase();
    const hit = (response.data.data ?? []).find(
      (item) => item.id?.trim().toLowerCase() === want,
    );
    const total = hit?.totalDownloads;
    return typeof total === "number" && Number.isFinite(total) && total > 0
      ? total
      : null;
  } catch {
    return null;
  }
}

function pickDependencyGroup(
  groups: NugetDependencyGroup[] | undefined,
): { framework: string | null; dependencies: Record<string, string> } {
  const usable = (groups ?? []).filter((group) =>
    (group.dependencies ?? []).some((dep) => dep.id?.trim()),
  );
  if (usable.length === 0) {
    return { framework: null, dependencies: {} };
  }
  const best = [...usable].sort(
    (a, b) => frameworkRank(b.targetFramework) - frameworkRank(a.targetFramework),
  )[0];
  const dependencies: Record<string, string> = {};
  for (const dep of best.dependencies ?? []) {
    const name = dep.id?.trim();
    if (!name) continue;
    dependencies[name] = dep.range?.trim() || "*";
  }
  return {
    framework: best.targetFramework?.trim() || null,
    dependencies,
  };
}

function parseTags(tags: CatalogEntry["tags"]): string[] | undefined {
  const raw = Array.isArray(tags) ? tags.join(" ") : tags ?? "";
  const keywords = raw
    .split(/[;,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return keywords.length > 0 ? keywords : undefined;
}

function repositoryFromNuspec(xml: string): NpmPackageData["repository"] | undefined {
  const match = xml.match(/<repository\b[^>]*\burl\s*=\s*"([^"]+)"/i);
  const url = match?.[1]?.trim();
  if (!url) return undefined;
  return { type: "git", url };
}

async function loadCatalogEntries(packageId: string): Promise<CatalogEntry[]> {
  const index = await getJson<{ items?: RegistrationPage[] }>(
    `${REGISTRATION}/${idPath(packageId)}/index.json`,
  );
  if (index.status === 404) {
    throw new Error(`Package "${packageId}" not found on NuGet`);
  }

  const entries: CatalogEntry[] = [];
  for (const page of index.data.items ?? []) {
    let leaves = page.items;
    if (!leaves?.length && page["@id"]) {
      const remote = await getJson<RegistrationPage>(page["@id"]);
      leaves = remote.data.items;
    }
    for (const leaf of leaves ?? []) {
      if (leaf.catalogEntry?.version) entries.push(leaf.catalogEntry);
    }
  }
  if (entries.length === 0) {
    throw new Error(`Package "${packageId}" not found on NuGet`);
  }
  return entries;
}

function pickLatest(entries: CatalogEntry[]): CatalogEntry {
  const listed = entries.filter((entry) => entry.listed !== false && entry.version);
  const pool = listed.length > 0 ? listed : entries;
  const stable = pool.filter((entry) => !isNugetPrerelease(entry.version ?? ""));
  const candidates = stable.length > 0 ? stable : pool;
  return [...candidates].sort((a, b) =>
    compareNugetVersions(b.version ?? "", a.version ?? ""),
  )[0];
}

export async function fetchNugetPackageData(packageName: string): Promise<{
  data: NpmPackageData;
  readme: string | null;
  distributionSize: DistributionSizeInfo | null;
  totalDownloads: number | null;
}> {
  try {
    const entries = await loadCatalogEntries(packageName);
    const latest = pickLatest(entries);
    const version = latest.version || "Unknown";
    const id = latest.id || packageName;
    const { framework, dependencies } = pickDependencyGroup(
      latest.dependencyGroups,
    );

    const time: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.version && entry.published) {
        time[entry.version] = entry.published;
      }
    }

    const flatId = idPath(id);
    const flatVersion = versionPath(version);
    const [nuspecResult, readmeResult, sizeResult, totalDownloads] =
      await Promise.all([
      axios
        .get<string>(
          `${FLAT_CONTAINER}/${flatId}/${flatVersion}/${flatId}.nuspec`,
          {
            headers: { "User-Agent": HEADERS["User-Agent"], Accept: "application/xml" },
            responseType: "text",
            validateStatus: (status) => status === 200 || status === 404,
          },
        )
        .catch(() => null),
      axios
        .get<string>(`${FLAT_CONTAINER}/${flatId}/${flatVersion}/readme`, {
          headers: { "User-Agent": HEADERS["User-Agent"] },
          responseType: "text",
          validateStatus: (status) => status === 200 || status === 404,
        })
        .catch(() => null),
      axios
        .head(
          `${FLAT_CONTAINER}/${flatId}/${flatVersion}/${flatId}.${flatVersion}.nupkg`,
          {
            headers: { "User-Agent": HEADERS["User-Agent"] },
            validateStatus: (status) => status === 200 || status === 404,
          },
        )
        .catch(() => null),
      fetchNugetTotalDownloads(id),
    ]);

    const nuspec =
      nuspecResult?.status === 200 ? String(nuspecResult.data) : "";
    const repository = nuspec ? repositoryFromNuspec(nuspec) : undefined;
    const readmeRaw =
      readmeResult?.status === 200 ? String(readmeResult.data).trim() : "";
    const contentLength = Number(sizeResult?.headers?.["content-length"]);
    const distributionSize =
      Number.isFinite(contentLength) && contentLength > 0
        ? {
            bytes: contentLength,
            packagetype: "nupkg",
            filename: `${id}.${version}.nupkg`,
          }
        : null;

    const formatted = formatNugetDescription(
      latest.description || latest.summary || "",
      latest.summary,
    );

    return {
      data: {
        name: id,
        version,
        description: formatted.description,
        license: latest.licenseExpression || latest.licenseUrl || undefined,
        repository,
        homepage: latest.projectUrl,
        keywords: parseTags(latest.tags),
        dependencies,
        engines: framework ? { dotnet: framework } : null,
        supportedFrameworks: listSupportedFrameworks(latest.dependencyGroups),
        commonlyUsedTypes: formatted.commonlyUsedTypes,
        descriptionNote: formatted.note,
        author: latest.authors,
        time: time as NpmPackageData["time"],
        distTags: { latest: version },
      },
      readme: readmeRaw ? readmeRaw.slice(0, 2000) : null,
      distributionSize,
      totalDownloads,
    };
  } catch (error: unknown) {
    if (error instanceof Error && /not found on NuGet/.test(error.message)) {
      throw error;
    }
    throw new Error(`Failed to fetch NuGet data: ${errorMessage(error)}`);
  }
}

export async function searchNugetPackages(
  query: string,
  limit: number = 8,
): Promise<NugetSearchResult[]> {
  const text = query.trim();
  if (text.length < 2) return [];

  const response = await axios.get<{
    data?: {
      id?: string;
      version?: string;
      description?: string;
      summary?: string;
    }[];
  }>(SEARCH_URL, {
    headers: HEADERS,
    params: { q: text, take: limit, prerelease: false },
  });

  const seen = new Set<string>();
  const packages: NugetSearchResult[] = [];
  for (const item of response.data.data ?? []) {
    const name = item.id?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    if (!validatePackageNameForEcosystem(name, "nuget").valid) continue;
    seen.add(name.toLowerCase());
    packages.push({
      name,
      description:
        formatNugetDescription(item.description, item.summary).description ||
        sanitizeDescription(item.summary) ||
        sanitizeDescription(item.description) ||
        "No description",
      version: item.version || "Unknown",
    });
    if (packages.length >= limit) break;
  }
  return packages;
}

const GENERIC_NUGET_TAGS = new Set([
  "net",
  "netcore",
  "netstandard",
  "nuget",
  "csharp",
  "c#",
  "dotnet",
  "library",
  "package",
  "microsoft",
  "system",
  "framework",
]);

type NugetSearchHit = {
  id?: string;
  version?: string;
  description?: string;
  summary?: string;
  tags?: string | string[];
  totalDownloads?: number;
};

function splitNugetTags(tags: NugetSearchHit["tags"]): string[] {
  const raw = Array.isArray(tags) ? tags.join(" ") : tags ?? "";
  return raw
    .split(/[;,\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length >= 3);
}

function distinctiveNugetTags(tags: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const distinctive: string[] = [];
  for (const tag of tags ?? []) {
    const key = tag.trim().toLowerCase();
    if (key.length < 3 || GENERIC_NUGET_TAGS.has(key) || seen.has(key)) continue;
    if (!/^[a-z0-9][a-z0-9.+_-]*$/i.test(tag.trim())) continue;
    seen.add(key);
    distinctive.push(tag.trim());
    if (distinctive.length >= 3) break;
  }
  return distinctive;
}

function nugetNameTokens(id: string): string[] {
  return id
    .split(/[.\-_]+/)
    .map((part) => part.trim())
    .filter((part) => {
      const key = part.toLowerCase();
      return key.length >= 3 && !GENERIC_NUGET_TAGS.has(key);
    });
}

async function searchNugetHits(
  query: string,
  take: number,
): Promise<NugetSearchHit[]> {
  const response = await axios.get<{ data?: NugetSearchHit[] }>(SEARCH_URL, {
    headers: HEADERS,
    params: { q: query, take, prerelease: false },
    timeout: 15_000,
  });
  return response.data.data ?? [];
}

/** Cards for AI-named NuGet alternatives. Inbox assemblies are omitted. */
export async function fetchNugetPackageCards(
  names: string[],
): Promise<NugetSearchResult[]> {
  const cards = await Promise.all(
    names.map(async (name) => {
      if (isDotnetInboxPackageId(name)) return null;
      if (!validatePackageNameForEcosystem(name, "nuget").valid) return null;
      try {
        const hits = await searchNugetHits(`packageid:${name}`, 1);
        const hit = hits.find(
          (item) => item.id?.toLowerCase() === name.toLowerCase(),
        );
        if (!hit?.id || isDotnetInboxPackageId(hit.id)) return null;
        return {
          name: hit.id,
          description:
            formatNugetDescription(hit.description, hit.summary).description ||
            sanitizeDescription(hit.summary) ||
            sanitizeDescription(hit.description) ||
            "No description",
          version: hit.version || "Unknown",
        };
      } catch {
        return null;
      }
    }),
  );
  return cards.filter((card): card is NugetSearchResult => card !== null);
}

/**
 * Related NuGet packages from tag and name overlap.
 * System.* and Microsoft.* assemblies are left out.
 */
export async function fetchSimilarNugetPackages(
  packageId: string,
  tags?: string[] | null,
  limit: number = 30,
): Promise<NugetSearchResult[]> {
  try {
    let sourceTags = distinctiveNugetTags(tags);
    if (sourceTags.length === 0) {
      const self = await searchNugetHits(`packageid:${packageId}`, 1);
      sourceTags = distinctiveNugetTags(splitNugetTags(self[0]?.tags));
    }

    const queries = new Set<string>();
    for (const tag of sourceTags) queries.add(`tags:${tag}`);
    const token = nugetNameTokens(packageId)[0];
    if (token) queries.add(token);
    if (queries.size === 0) queries.add(packageId);

    const searches = await Promise.allSettled(
      [...queries].map((query) => searchNugetHits(query, 20)),
    );

    const current = packageId.toLowerCase();
    const sourceTokens = new Set(
      nugetNameTokens(packageId).map((part) => part.toLowerCase()),
    );
    const sourceTagSet = new Set(sourceTags.map((tag) => tag.toLowerCase()));
    const seen = new Set<string>([current]);
    const ranked: Array<NugetSearchResult & { score: number }> = [];

    for (const result of searches) {
      if (result.status !== "fulfilled") continue;
      for (const hit of result.value) {
        const name = hit.id?.trim();
        if (!name || isDotnetInboxPackageId(name)) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        if (!validatePackageNameForEcosystem(name, "nuget").valid) continue;
        seen.add(key);

        const hitTags = splitNugetTags(hit.tags).map((tag) => tag.toLowerCase());
        const overlap = hitTags.filter((tag) => sourceTagSet.has(tag)).length;
        const sharedTokens = nugetNameTokens(name).filter((part) =>
          sourceTokens.has(part.toLowerCase()),
        ).length;
        if (overlap === 0 && sharedTokens === 0) continue;

        const downloads = Math.log10((hit.totalDownloads ?? 0) + 1);
        ranked.push({
          name,
          description:
            formatNugetDescription(hit.description, hit.summary).description ||
            sanitizeDescription(hit.summary) ||
            sanitizeDescription(hit.description) ||
            "No description",
          version: hit.version || "Unknown",
          score: overlap * 4 + sharedTokens * 2 + downloads / 10,
        });
      }
    }

    return ranked
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ name, description, version }) => ({ name, description, version }));
  } catch (error: unknown) {
    console.warn("Could not fetch similar NuGet packages:", errorMessage(error));
    return [];
  }
}
