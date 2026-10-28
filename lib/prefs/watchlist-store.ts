"use client";

import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { watchlistEntryKey } from "@/lib/packages/package-routes";
import {
  getWatchlistAlerts,
  summarizeWatchlistAlerts,
  watchlistAfterAcknowledge,
  watchlistAfterPoll,
  watchlistAfterVisit,
  watchlistEntryHasAlerts,
  type WatchlistAdvisory,
  type WatchlistAlerts,
  type WatchlistDependencyAdvisory,
  type WatchlistEntry,
  type WatchlistFresh,
  type WatchlistSummary,
} from "@/lib/prefs/watchlist-alerts";

export type {
  WatchlistAdvisory,
  WatchlistAlerts,
  WatchlistDependencyAdvisory,
  WatchlistEntry,
  WatchlistFresh,
  WatchlistSummary,
};
export {
  getWatchlistAlerts,
  summarizeWatchlistAlerts,
  watchlistEntryHasAlerts,
};

/** Poll at most once per day - typical npm releases are weeks/months apart. */
export const WATCHLIST_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const STORAGE_KEY = "npv-watchlist-v2";
const LEGACY_STORAGE_KEY = "npv-watchlist-v1";
const MAX_ENTRIES = 50;

type Listener = () => void;

const listeners = new Set<Listener>();

/** Cached snapshot for useSyncExternalStore - must be referentially stable until data changes. */
const EMPTY_SNAPSHOT: WatchlistEntry[] = [];
let snapshot: WatchlistEntry[] = EMPTY_SNAPSHOT;
/** True after localStorage has been read on the client (post-hydration). */
let storageHydrated = false;

function emit() {
  for (const listener of listeners) listener();
}

function hydrateFromStorage(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  snapshot = sortEntries(readRaw());
  emit();
}

export function subscribeWatchlist(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageHydrated) {
    queueMicrotask(() => hydrateFromStorage());
  }
  return () => listeners.delete(listener);
}

function normalizeEntry(entry: WatchlistEntry): WatchlistEntry {
  return {
    ...entry,
    ecosystem:
      entry.ecosystem === "pypi"
        ? "pypi"
        : entry.ecosystem === "nuget"
          ? "nuget"
          : entry.ecosystem === "maven"
            ? "maven"
            : "npm",
  };
}

function sortEntries(entries: WatchlistEntry[]): WatchlistEntry[] {
  return [...entries].sort((a, b) => {
    const eco = (a.ecosystem ?? "npm").localeCompare(b.ecosystem ?? "npm");
    if (eco !== 0) return eco;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function readRaw(): WatchlistEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy) as unknown;
        if (Array.isArray(parsedLegacy)) {
          const migrated = sortEntries(
            parsedLegacy
              .filter(
                (entry): entry is WatchlistEntry =>
                  Boolean(
                    entry &&
                      typeof entry === "object" &&
                      typeof (entry as WatchlistEntry).name === "string" &&
                      typeof (entry as WatchlistEntry).pinnedAt === "number",
                  ),
              )
              .map((entry) => normalizeEntry({ ...entry, ecosystem: "npm" }))
              .slice(0, MAX_ENTRIES),
          );
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          return migrated;
        }
      }
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is WatchlistEntry =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              typeof (entry as WatchlistEntry).name === "string" &&
              typeof (entry as WatchlistEntry).pinnedAt === "number",
          ),
      )
      .map(normalizeEntry)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeRaw(entries: WatchlistEntry[]) {
  if (typeof window === "undefined") return;
  const next = sortEntries(entries.slice(0, MAX_ENTRIES));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode - ignore
  }
  snapshot = next;
  storageHydrated = true;
  emit();
}

function ensureHydrated(): WatchlistEntry[] {
  if (!storageHydrated) {
    hydrateFromStorage();
  }
  return snapshot;
}

export function getWatchlistSnapshot(): WatchlistEntry[] {
  if (!storageHydrated) {
    return EMPTY_SNAPSHOT;
  }
  return snapshot;
}

export function getWatchlistServerSnapshot(): WatchlistEntry[] {
  return EMPTY_SNAPSHOT;
}

export function listWatchlist(): WatchlistEntry[] {
  return ensureHydrated();
}

export function isWatched(
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): boolean {
  const key = watchlistEntryKey(ecosystem, packageName);
  return ensureHydrated().some(
    (entry) =>
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) === key,
  );
}

export function countWatchlistAlerts(entries: WatchlistEntry[] = listWatchlist()): number {
  return entries.filter(watchlistEntryHasAlerts).length;
}

export function getWatchlistEntriesNeedingCheck(
  now = Date.now(),
): WatchlistEntry[] {
  return ensureHydrated().filter((entry) => {
    if (!entry.lastCheckedAt) return true;
    return now - entry.lastCheckedAt >= WATCHLIST_CHECK_INTERVAL_MS;
  });
}

export function addToWatchlist(
  packageName: string,
  summary?: WatchlistSummary,
  ecosystem: PackageEcosystem = "npm",
): WatchlistEntry[] {
  const name = packageName.trim();
  if (!name) return listWatchlist();

  const key = watchlistEntryKey(ecosystem, name);
  const now = Date.now();
  const current = ensureHydrated().filter(
    (entry) =>
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) !== key,
  );
  writeRaw([
    {
      name,
      ecosystem,
      pinnedAt: now,
      lastCheckedAt: summary ? now : undefined,
      summary,
      fresh: summary
        ? {
            version: summary.version,
            vulnerabilityCount: summary.vulnerabilityCount,
            advisories: summary.advisories,
            dependencyAdvisories: summary.dependencyAdvisories,
            deprecated: summary.deprecated,
          }
        : undefined,
    },
    ...current,
  ]);
  return listWatchlist();
}

export function removeFromWatchlist(
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): WatchlistEntry[] {
  const key = watchlistEntryKey(ecosystem, packageName);
  writeRaw(
    ensureHydrated().filter(
      (entry) =>
        watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) !== key,
    ),
  );
  return listWatchlist();
}

export function toggleWatchlist(
  packageName: string,
  summary?: WatchlistSummary,
  ecosystem: PackageEcosystem = "npm",
): boolean {
  if (isWatched(packageName, ecosystem)) {
    removeFromWatchlist(packageName, ecosystem);
    return false;
  }
  addToWatchlist(packageName, summary, ecosystem);
  return true;
}

export function updateWatchlistSummary(
  packageName: string,
  summary: WatchlistSummary,
  ecosystem: PackageEcosystem = "npm",
): void {
  const key = watchlistEntryKey(ecosystem, packageName);
  const now = Date.now();
  const current = ensureHydrated();
  const existing = current.find(
    (entry) =>
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) === key,
  );
  if (!existing) return;

  const next = watchlistAfterVisit(existing, summary, now);
  if (
    summariesEqual(existing.summary, next.summary) &&
    freshEqual(existing.fresh, next.fresh) &&
    existing.lastCheckedAt === next.lastCheckedAt
  ) {
    return;
  }

  writeRaw(
    current.map((entry) =>
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) === key
        ? next
        : entry,
    ),
  );
}

/** Accept the latest poll, which clears notices for this package. */
export function acknowledgeWatchlist(
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): void {
  const key = watchlistEntryKey(ecosystem, packageName);
  const current = ensureHydrated();
  const existing = current.find(
    (entry) =>
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) === key,
  );
  if (!existing) return;
  const next = watchlistAfterAcknowledge(existing);
  if (summariesEqual(existing.summary, next.summary)) return;
  writeRaw(
    current.map((entry) =>
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) === key
        ? next
        : entry,
    ),
  );
}

/** Apply polled status without treating it as a user review. */
export function applyWatchlistFreshStatuses(
  updates: (WatchlistFresh & { name: string; ecosystem?: PackageEcosystem })[],
  checkedAt = Date.now(),
): void {
  if (updates.length === 0) return;
  const byName = new Map(
    updates.map(
      (u) =>
        [
          watchlistEntryKey(u.ecosystem ?? "npm", u.name),
          u,
        ] as const,
    ),
  );
  const current = ensureHydrated();
  let changed = false;

  const next = current.map((entry) => {
    const update = byName.get(
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name),
    );
    if (!update) return entry;

    const next = watchlistAfterPoll(entry, update, checkedAt);
    if (
      entry.lastCheckedAt === next.lastCheckedAt &&
      freshEqual(entry.fresh, next.fresh) &&
      summariesEqual(entry.summary, next.summary)
    ) {
      return entry;
    }

    changed = true;
    return next;
  });

  if (changed) writeRaw(next);
}

function summariesEqual(
  a: WatchlistSummary | undefined,
  b: WatchlistSummary | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.version === b.version &&
    a.qualityScore === b.qualityScore &&
    a.vulnerabilityCount === b.vulnerabilityCount &&
    a.deprecated === b.deprecated &&
    a.recommendation === b.recommendation &&
    advisoryKey(a.advisories) === advisoryKey(b.advisories) &&
    dependencyKey(a.dependencyAdvisories) === dependencyKey(b.dependencyAdvisories)
  );
}

function advisoryKey(advisories: WatchlistSummary["advisories"]): string {
  if (!advisories) return "";
  return advisories.map((advisory) => advisory.id).join("|");
}

function dependencyKey(
  dependencies: WatchlistSummary["dependencyAdvisories"],
): string {
  if (!dependencies) return "";
  return dependencies
    .map((dep) => `${dep.name}:${dep.ids.join(",")}`)
    .join("|");
}

function freshEqual(
  a: WatchlistFresh | undefined,
  b: WatchlistFresh | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.version === b.version &&
    a.vulnerabilityCount === b.vulnerabilityCount &&
    a.deprecated === b.deprecated &&
    advisoryKey(a.advisories) === advisoryKey(b.advisories) &&
    dependencyKey(a.dependencyAdvisories) === dependencyKey(b.dependencyAdvisories)
  );
}

export function clearWatchlist(): void {
  writeRaw([]);
}
