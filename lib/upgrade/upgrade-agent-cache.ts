const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 100;

export type CachedUpgradeBrief = {
  packageName: string;
  from: string;
  to: string;
  packageManager: string;
  brief: {
    headline: string;
    bullets: string[];
    risk: "low" | "moderate" | "high";
    nextSteps: string[];
  };
  model: string;
  toolCalls: string[];
  cachedAt: number;
};

type CacheEntry = {
  data: CachedUpgradeBrief;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CachedUpgradeBrief>>();

export const upgradeAgentCacheKey = (
  packageName: string,
  from: string,
  to: string,
  packageManager: string,
): string =>
  [
    packageName.trim().toLowerCase(),
    from.trim(),
    to.trim(),
    packageManager.trim().toLowerCase() || "auto",
  ].join("|");

const prune = () => {
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = cache.keys().next().value;
  if (oldest) cache.delete(oldest);
};

export const getCachedUpgradeBrief = (
  key: string,
): CachedUpgradeBrief | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

export const setCachedUpgradeBrief = (
  key: string,
  data: Omit<CachedUpgradeBrief, "cachedAt">,
): CachedUpgradeBrief => {
  const stored: CachedUpgradeBrief = { ...data, cachedAt: Date.now() };
  cache.set(key, { data: stored, expiresAt: Date.now() + TTL_MS });
  prune();
  return stored;
};

export const getInflightUpgradeBrief = (
  key: string,
): Promise<CachedUpgradeBrief> | null => inflight.get(key) ?? null;

export const setInflightUpgradeBrief = (
  key: string,
  promise: Promise<CachedUpgradeBrief>,
): void => {
  inflight.set(key, promise);
  void promise.finally(() => {
    inflight.delete(key);
  });
};
