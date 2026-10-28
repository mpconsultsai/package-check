import { jsonOk, withHandler } from "@/lib/api/http";
import { parseEcosystem } from "@/lib/api/params";
import { searchNpmPackages } from "@/lib/data-fetchers/npm-registry";
import { searchPypiPackages } from "@/lib/data-fetchers/pypi-registry";
import { searchNugetPackages } from "@/lib/data-fetchers/nuget-registry";
import { searchMavenPackages } from "@/lib/data-fetchers/maven-registry";
import { clientMetadata } from "@/lib/db/client-metadata";
import { recordPackageSearch } from "@/lib/db/package-searches";

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

type CacheEntry = {
  packages: Awaited<ReturnType<typeof searchNpmPackages>>;
  expiresAt: number;
};
const searchCache = new Map<string, CacheEntry>();

const getCached = (key: string): CacheEntry["packages"] | null => {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.packages;
};

const setCached = (key: string, packages: CacheEntry["packages"]) => {
  if (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, { packages, expiresAt: Date.now() + CACHE_TTL_MS });
};

/** GET /api/v1/packages/search?q=&limit= */
export const GET = withHandler(
  async (request) => {
    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "8", 10) || 8, 1),
      20,
    );

    if (q.length < 2) {
      return jsonOk({ packages: [] });
    }

    const started = Date.now();
    const ecosystem = parseEcosystem(
      request.nextUrl.searchParams.get("ecosystem"),
    );
    const cacheKey = `v3:${ecosystem}:${q.toLowerCase()}:${limit}`;
    const cached = getCached(cacheKey);
    const packages =
      cached ??
      (ecosystem === "pypi"
        ? await searchPypiPackages(q, limit)
        : ecosystem === "nuget"
          ? await searchNugetPackages(q, limit)
          : ecosystem === "maven"
            ? await searchMavenPackages(q, limit)
            : await searchNpmPackages(q, limit));
    if (!cached) setCached(cacheKey, packages);
    await recordPackageSearch({
      ecosystem,
      query: q,
      resultNames: packages.map((item) => item.name),
      source: "web",
      metadata: {
        limit,
        cacheHit: cached !== null,
        durationMs: Date.now() - started,
        ...clientMetadata(request.headers),
      },
    });
    return jsonOk({ packages });
  },
  { logLabel: "packages/search", fallbackMessage: "Failed to search packages" },
);
