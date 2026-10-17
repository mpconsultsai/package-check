import { analyzePackage } from "@/lib/data-fetchers/package-analyzer";
import type {
  PackageAnalysisResult,
  PackageEcosystem,
} from "@/lib/types/package-data";

const TTL_MS = 2 * 60 * 1000;

type CacheEntry = {
  data: PackageAnalysisResult;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
/** Coalesce concurrent analyze + analyze-ai cache misses into one fetch. */
const inflight = new Map<string, Promise<PackageAnalysisResult>>();

/**
 * Short-lived in-memory cache so progressive /api/v1/analysis/metrics → /api/v1/analysis/ai
 * does not re-hit npm/GitHub/Bundlephobia for the same package.
 */
export async function analyzePackageCached(
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): Promise<PackageAnalysisResult> {
  const key = `${ecosystem}|${packageName.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = analyzePackage(packageName, ecosystem)
    .then((data) => {
      cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
