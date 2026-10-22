import axios from "axios";
import {
  advisoryEcosystem,
  type PackageEcosystem,
} from "@/lib/packages/package-routes";
import { fetchNpmDirectAdvisories } from "./deps-dev";
import { checkPackageSecurity } from "./security";
import { fetchPypiPackageData } from "./pypi-registry";
import { fetchNugetPackageData } from "./nuget-registry";
import {
  compactAdvisories,
  compactDependencyAdvisories,
  type WatchlistAdvisory,
  type WatchlistDependencyAdvisory,
} from "@/lib/prefs/watchlist-alerts";

const NPM_REGISTRY_URL = "https://registry.npmjs.org";

export interface WatchlistPackageStatus {
  name: string;
  ecosystem: PackageEcosystem;
  version: string;
  vulnerabilityCount: number;
  advisories?: WatchlistAdvisory[];
  /** Present for npm after a deps.dev lookup. Absent when that lookup fails. */
  dependencyAdvisories?: WatchlistDependencyAdvisory[];
  deprecated: boolean;
}

async function fetchNpmLatestMeta(
  packageName: string,
): Promise<{ version: string; deprecated: boolean } | null> {
  try {
    const response = await axios.get(
      `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`,
      {
        timeout: 5000,
        validateStatus: (status) => status === 200 || status === 404,
      },
    );
    if (response.status === 404) return null;
    return {
      version:
        typeof response.data?.version === "string" ? response.data.version : "",
      deprecated: Boolean(response.data?.deprecated),
    };
  } catch {
    return null;
  }
}

async function fetchPypiLatestMeta(
  packageName: string,
): Promise<{ version: string; deprecated: boolean } | null> {
  try {
    const { data } = await fetchPypiPackageData(packageName);
    return {
      version: data.version,
      deprecated: Boolean(data.deprecated),
    };
  } catch {
    return null;
  }
}

async function fetchNugetLatestMeta(
  packageName: string,
): Promise<{ version: string; deprecated: boolean } | null> {
  try {
    const { data } = await fetchNugetPackageData(packageName);
    return {
      version: data.version,
      deprecated: Boolean(data.deprecated),
    };
  } catch {
    return null;
  }
}

export async function fetchWatchlistPackageStatus(
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): Promise<WatchlistPackageStatus | null> {
  const meta =
    ecosystem === "pypi"
      ? await fetchPypiLatestMeta(packageName)
      : ecosystem === "nuget"
        ? await fetchNugetLatestMeta(packageName)
        : await fetchNpmLatestMeta(packageName);
  if (!meta?.version) return null;

  let vulnerabilityCount = 0;
  let advisories: WatchlistAdvisory[] | undefined;
  try {
    const security = await checkPackageSecurity(
      packageName,
      meta.version,
      advisoryEcosystem(ecosystem),
    );
    vulnerabilityCount = security.totalCount;
    advisories = compactAdvisories(security.vulnerabilities);
  } catch {
    // Keep version and deprecation even if advisories fail
  }

  let dependencyAdvisories: WatchlistDependencyAdvisory[] | undefined;
  if (ecosystem === "npm") {
    try {
      dependencyAdvisories = compactDependencyAdvisories(
        await fetchNpmDirectAdvisories(packageName, meta.version),
      );
    } catch {
      // Leave the field unset so a failed lookup is not stored as "none".
    }
  }

  return {
    name: packageName,
    ecosystem,
    version: meta.version,
    vulnerabilityCount,
    ...(advisories ? { advisories } : {}),
    ...(dependencyAdvisories ? { dependencyAdvisories } : {}),
    deprecated: meta.deprecated,
  };
}

/** Run async work with a concurrency cap. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}
