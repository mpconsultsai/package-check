type NodeDistEntry = {
  version?: string;
  lts?: false | string;
};

const INDEX_URL = "https://nodejs.org/dist/index.json";

let cachedLts: { version: string; fetchedAt: number } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

/** Strip a leading `v` from Node dist versions. */
export function stripNodeVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, "");
}

/**
 * Newest LTS from nodejs.org dist index (newest-first; first truthy `lts`).
 * Prefers LTS over Current so the upgrade default matches production runtimes.
 */
export function pickLatestNodeLts(index: NodeDistEntry[]): string | null {
  for (const entry of index) {
    if (!entry?.lts || typeof entry.version !== "string") continue;
    const version = stripNodeVersionPrefix(entry.version);
    if (/^\d+\.\d+\.\d+$/.test(version)) return version;
  }
  return null;
}

export async function fetchLatestNodeLts(
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (cachedLts && Date.now() - cachedLts.fetchedAt < CACHE_MS) {
    return cachedLts.version;
  }
  try {
    const response = await fetcher(INDEX_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return cachedLts?.version ?? null;
    const index = (await response.json()) as NodeDistEntry[];
    if (!Array.isArray(index)) return cachedLts?.version ?? null;
    const version = pickLatestNodeLts(index);
    if (version) cachedLts = { version, fetchedAt: Date.now() };
    return version;
  } catch {
    return cachedLts?.version ?? null;
  }
}
