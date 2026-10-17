"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/prefs/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import {
  applyWatchlistFreshStatuses,
  getWatchlistEntriesNeedingCheck,
  type WatchlistFresh,
} from "@/lib/prefs/watchlist-store";
import { useWatchlist } from "@/lib/prefs/use-watchlist";

interface CheckResponse {
  packages?: Array<
    WatchlistFresh & {
      name: string;
    }
  >;
  checkedAt?: number;
  error?: string;
}

/**
 * On the homepage, refresh stale watchlist packages at most once per day each.
 */
export function useWatchlistRefresh(enabled: boolean) {
  const entries = useWatchlist();
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled || inFlight.current) return;

    const needing = getWatchlistEntriesNeedingCheck();
    if (needing.length === 0) return;

    const controller = new AbortController();
    inFlight.current = true;
    setChecking(true);

    void (async () => {
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
            signal: controller.signal,
            timeoutMs: 90_000,
            retries: 1,
          },
        );
        if (controller.signal.aborted || !ok) return;
        const updates = (data.packages ?? []).filter(
          (pkg): pkg is WatchlistFresh & { name: string } =>
            Boolean(pkg?.name && pkg.version),
        );
        applyWatchlistFreshStatuses(updates, data.checkedAt ?? Date.now());
      } catch {
        // Silent - watchlist still usable offline / on failure
      } finally {
        if (!controller.signal.aborted) setChecking(false);
        inFlight.current = false;
      }
    })();

    return () => {
      controller.abort();
      inFlight.current = false;
    };
  }, [enabled, entries.length]);

  return { checking };
}
