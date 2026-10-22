"use client";

import { useSyncExternalStore, useCallback } from "react";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import {
  getWatchlistSnapshot,
  getWatchlistServerSnapshot,
  subscribeWatchlist,
  isWatched,
  toggleWatchlist,
  addToWatchlist,
  acknowledgeWatchlist,
  updateWatchlistSummary,
  removeFromWatchlist,
  type WatchlistSummary,
} from "@/lib/prefs/watchlist-store";

export function useWatchlist() {
  return useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    getWatchlistServerSnapshot,
  );
}

export function useIsWatched(
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): boolean {
  const entries = useWatchlist();
  const key = `${ecosystem}:${packageName.toLowerCase()}`;
  return entries.some(
    (entry) =>
      `${entry.ecosystem ?? "npm"}:${entry.name.toLowerCase()}` === key,
  );
}

export function useWatchlistActions() {
  const toggle = useCallback(
    (
      packageName: string,
      summary?: WatchlistSummary,
      ecosystem: PackageEcosystem = "npm",
    ) => toggleWatchlist(packageName, summary, ecosystem),
    [],
  );
  const add = useCallback(
    (
      packageName: string,
      summary?: WatchlistSummary,
      ecosystem: PackageEcosystem = "npm",
    ) => {
      if (isWatched(packageName, ecosystem)) {
        if (summary) updateWatchlistSummary(packageName, summary, ecosystem);
        return;
      }
      addToWatchlist(packageName, summary, ecosystem);
    },
    [],
  );
  const remove = useCallback(
    (packageName: string, ecosystem: PackageEcosystem = "npm") => {
      removeFromWatchlist(packageName, ecosystem);
    },
    [],
  );
  const acknowledge = useCallback(
    (packageName: string, ecosystem: PackageEcosystem = "npm") => {
      acknowledgeWatchlist(packageName, ecosystem);
    },
    [],
  );
  const updateSummary = useCallback(
    (
      packageName: string,
      summary: WatchlistSummary,
      ecosystem: PackageEcosystem = "npm",
    ) => {
      if (!isWatched(packageName, ecosystem)) return;
      updateWatchlistSummary(packageName, summary, ecosystem);
    },
    [],
  );

  return { toggle, add, remove, acknowledge, updateSummary };
}
