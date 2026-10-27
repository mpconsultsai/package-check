"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/prefs/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import {
  applyWatchlistFreshStatuses,
  getWatchlistEntriesNeedingCheck,
  listWatchlist,
  type WatchlistFresh,
} from "@/lib/prefs/watchlist-store";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { useWatchlist } from "@/lib/prefs/use-watchlist";

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
 * Refresh stale watchlist packages at most once per day each when `auto` is on.
 * checkNow ignores that interval.
 */
export function useWatchlistRefresh(auto: boolean) {
  const entries = useWatchlist();
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

  useEffect(() => {
    if (!auto) return;
    const controller = new AbortController();
    void runCheck(false, controller.signal);
    return () => controller.abort();
  }, [auto, entries.length, runCheck]);

  const checkNow = useCallback(() => {
    void runCheck(true);
  }, [runCheck]);

  return { checking, error, checkNow };
}
