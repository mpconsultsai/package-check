import { jsonOk, withHandler } from "@/lib/api/http";
import { readJsonBody } from "@/lib/api/params";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import {
  fetchWatchlistPackageStatus,
  mapPool,
} from "@/lib/data-fetchers/watchlist-status";
import {
  extractPackageName,
  validatePackageNameForEcosystem,
} from "@/lib/packages/validation";

const MAX_PACKAGES = 50;
const CONCURRENCY = 4;

type WatchlistCheckItem = { name: string; ecosystem: PackageEcosystem };

function parseWatchlistCheckItems(raw: unknown[]): WatchlistCheckItem[] {
  const items: WatchlistCheckItem[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const name = extractPackageName(entry);
      if (name && validatePackageNameForEcosystem(name, "npm").valid) {
        items.push({ name, ecosystem: "npm" });
      }
      continue;
    }
    if (entry && typeof entry === "object") {
      const obj = entry as { name?: unknown; ecosystem?: unknown };
      const name =
        typeof obj.name === "string" ? extractPackageName(obj.name) : "";
      const ecosystem =
        obj.ecosystem === "pypi" || obj.ecosystem === "pip"
          ? "pypi"
          : obj.ecosystem === "nuget"
            ? "nuget"
            : "npm";
      if (name && validatePackageNameForEcosystem(name, ecosystem).valid) {
        items.push({ name, ecosystem });
      }
    }
  }
  const seen = new Set<string>();
  const unique: WatchlistCheckItem[] = [];
  for (const item of items) {
    const key = `${item.ecosystem}:${item.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= MAX_PACKAGES) break;
  }
  return unique;
}

/** POST /api/v1/watchlist/check { packages: string[] | { name, ecosystem }[] } */
export const POST = withHandler(
  async (request) => {
    const body = await readJsonBody(request);
    const raw: unknown[] = Array.isArray(body.packages) ? body.packages : [];
    const items = parseWatchlistCheckItems(raw);

    if (items.length === 0) {
      return jsonOk({ packages: [] });
    }

    const results = await mapPool(items, CONCURRENCY, async (item) => {
      try {
        return await fetchWatchlistPackageStatus(item.name, item.ecosystem);
      } catch {
        return null;
      }
    });

    return jsonOk({
      packages: results.filter(Boolean),
      checkedAt: Date.now(),
    });
  },
  {
    logLabel: "watchlist/check",
    fallbackMessage: "Watchlist check failed",
  },
);
