"use client";

import { useCallback, useRef, useState } from "react";
import { fetchJson } from "@/lib/prefs/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import {
  applyWatchlistFreshStatuses,
  getWatchlistEntriesNeedingCheck,
  listWatchlist,
  type WatchlistFresh,
} from "@/lib/prefs/watchlist-store";
import type { PackageEcosystem } from "@/lib/packages/package-routes";

interface CheckResponse {
  packages?: Array<
    WatchlistFresh & {
      name: string;
      ecosystem?: PackageEcosystem;
    }
  >;
  checkedAt?: number;
  error?: string;
}

const CHECK_FAILED = "Could not check the watchlist";

/**
 * Watchlist registry poll. Stale packages are checked at most once per day
 * unless `checkNow` forces a full refresh. No automatic page-load polling —
 * call `checkStale` when the Watchlist panel opens.
 */
export function useWatchlistRefresh() {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const runCheck = useCallback(async (force: boolean, signal?: AbortSignal) => {
    if (inFlight.current) return;
    const needing = force ? listWatchlist() : getWatchlistEntriesNeedingCheck();
    if (needing.length === 0) return;

    inFlight.current = true;
    setChecking(true);
    if (force) setError(null);

    try {
      const { ok, data } = await fetchJson<CheckResponse>(
        apiPaths.watchlist.check,
        {
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              packages: needing.map((entry) => ({
                name: entry.name,
                ecosystem: entry.ecosystem ?? "npm",
              })),
            }),
          },
          signal,
          timeoutMs: 90_000,
          retries: 1,
        },
      );
      if (signal?.aborted) return;
      const updates = (data.packages ?? []).filter(
        (pkg): pkg is WatchlistFresh & { name: string; ecosystem?: PackageEcosystem } =>
          Boolean(pkg?.name && pkg.version),
      );
      if (!ok) {
        setError(data.error || CHECK_FAILED);
        return;
      }
      setError(null);
      applyWatchlistFreshStatuses(updates, data.checkedAt ?? Date.now());
    } catch {
      if (!signal?.aborted) setError(CHECK_FAILED);
    } finally {
      setChecking(false);
      inFlight.current = false;
    }
  }, []);

  const checkNow = useCallback(() => {
    void runCheck(true);
  }, [runCheck]);

  const checkStale = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);

  return { checking, error, checkNow, checkStale };
}
