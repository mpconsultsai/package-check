"use client";

import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { watchlistEntryKey } from "@/lib/packages/package-routes";

export interface WatchlistSummary {
  version?: string;
  qualityScore?: number;
  vulnerabilityCount?: number;
  deprecated?: boolean;
  recommendation?: string;
}

/** Latest polled registry/security snapshot (may differ from last reviewed summary). */
export type WatchlistFresh = Pick<
  WatchlistSummary,
  "version" | "vulnerabilityCount" | "deprecated"
>;

export interface WatchlistAlerts {
  newVersion: boolean;
  newVulns: boolean;
  newlyDeprecated: boolean;
}

export interface WatchlistEntry {
  name: string;
  ecosystem?: PackageEcosystem;
  pinnedAt: number;
  /** When we last polled npm/security for this package */
  lastCheckedAt?: number;
  /** Snapshot from last package-page analyse (user review baseline) */
  summary?: WatchlistSummary;
  /** Latest poll result */
  fresh?: WatchlistFresh;
}

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

export function getWatchlistAlerts(entry: WatchlistEntry): WatchlistAlerts {
  const baseline = entry.summary;
  const fresh = entry.fresh;
  if (!baseline || !fresh) {
    return { newVersion: false, newVulns: false, newlyDeprecated: false };
  }

  const baseVulns = baseline.vulnerabilityCount ?? 0;
  const freshVulns = fresh.vulnerabilityCount ?? 0;

  return {
    newVersion: Boolean(
      baseline.version &&
        fresh.version &&
        baseline.version !== fresh.version,
    ),
    newVulns: freshVulns > baseVulns,
    newlyDeprecated: Boolean(fresh.deprecated && !baseline.deprecated),
  };
}

export function watchlistEntryHasAlerts(entry: WatchlistEntry): boolean {
  const alerts = getWatchlistAlerts(entry);
  return alerts.newVersion || alerts.newVulns || alerts.newlyDeprecated;
}

export function countWatchlistAlerts(entries: WatchlistEntry[] = listWatchlist()): number {
  return entries.filter(watchlistEntryHasAlerts).length;
}

/** Counts packages with each change type - for the watchlist icon badge. */
export function summarizeWatchlistAlerts(
  entries: WatchlistEntry[] = listWatchlist(),
): {
  total: number;
  newVulns: number;
  newVersion: number;
  newlyDeprecated: number;
  /** Prefer security (red) over version (green) over deprecated (orange). */
  tone: "none" | "vulns" | "version" | "deprecated";
} {
  let newVulns = 0;
  let newVersion = 0;
  let newlyDeprecated = 0;

  for (const entry of entries) {
    const alerts = getWatchlistAlerts(entry);
    if (alerts.newVulns) newVulns += 1;
    if (alerts.newVersion) newVersion += 1;
    if (alerts.newlyDeprecated) newlyDeprecated += 1;
  }

  const total = entries.filter(watchlistEntryHasAlerts).length;
  const tone =
    newVulns > 0
      ? "vulns"
      : newVersion > 0
        ? "version"
        : newlyDeprecated > 0
          ? "deprecated"
          : "none";

  return { total, newVulns, newVersion, newlyDeprecated, tone };
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

  const nextFresh: WatchlistFresh = {
    version: summary.version,
    vulnerabilityCount: summary.vulnerabilityCount,
    deprecated: summary.deprecated,
  };

  if (
    summariesEqual(existing.summary, summary) &&
    freshEqual(existing.fresh, nextFresh)
  ) {
    return;
  }

  writeRaw(
    current.map((entry) =>
      watchlistEntryKey(entry.ecosystem ?? "npm", entry.name) === key
        ? {
            ...entry,
            lastCheckedAt: now,
            summary,
            fresh: nextFresh,
          }
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

    const fresh: WatchlistFresh = {
      version: update.version,
      vulnerabilityCount: update.vulnerabilityCount,
      deprecated: update.deprecated,
    };

    // First successful poll with no baseline - adopt as reviewed snapshot
    const summary =
      entry.summary ??
      ({
        version: fresh.version,
        vulnerabilityCount: fresh.vulnerabilityCount,
        deprecated: fresh.deprecated,
      } satisfies WatchlistSummary);

    if (
      entry.lastCheckedAt === checkedAt &&
      freshEqual(entry.fresh, fresh) &&
      summariesEqual(entry.summary, summary)
    ) {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      lastCheckedAt: checkedAt,
      summary: entry.summary ?? summary,
      fresh,
    };
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
    a.recommendation === b.recommendation
  );
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
    a.deprecated === b.deprecated
  );
}

export function clearWatchlist(): void {
  writeRaw([]);
}
