"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/prefs/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import {
  snapshotFromAnalysis,
  type CompareColumn,
} from "@/lib/packages/package-compare";
import { PackageCompareTable } from "./PackageCompareTable";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { packagePagePath } from "@/lib/packages/package-routes";

const COMPARE_CAP = 2;

interface SimilarPackage {
  name: string;
  description: string;
  version: string;
  competitor?: boolean;
}

interface SimilarPackagesCardProps {
  packageName: string;
  ecosystem?: PackageEcosystem;
  /** Pass when available from analysis to avoid extra API work */
  keywords?: string[] | null;
  /** AI-named alternative packages */
  competitors?: string[] | null;
  current?: CompareColumn | null;
}

function RelatedPackagesSkeleton() {
  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6"
      role="status"
    >
      <span className="sr-only">Loading related packages</span>
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        aria-hidden="true"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="p-4 rounded-lg border border-rule"
          >
            <div className="h-5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="mt-2 h-3 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="mt-3 h-3 w-full rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="mt-2 h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SimilarPackagesCard({
  packageName,
  ecosystem = "npm",
  keywords,
  competitors,
  current,
}: SimilarPackagesCardProps) {
  const keywordsKey = (keywords ?? []).join(",");
  const competitorsKey = (competitors ?? []).join(",");
  const [packages, setPackages] = useState<SimilarPackage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(packageName));
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [fetched, setFetched] = useState<Record<string, CompareColumn>>({});
  const fetchedRef = useRef(fetched);
  fetchedRef.current = fetched;
  const compareAbortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSelected([]);
    setFetched({});
    setNextCursor(null);
    compareAbortRef.current?.abort();
    compareAbortRef.current = new AbortController();
    moreAbortRef.current?.abort();
    return () => {
      compareAbortRef.current?.abort();
      moreAbortRef.current?.abort();
    };
  }, [packageName]);

  useEffect(() => {
    if (!packageName) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      package: packageName,
      ecosystem,
    });
    if (keywordsKey) params.set("keywords", keywordsKey);
    if (competitorsKey) params.set("competitors", competitorsKey);

    setLoading(true);
    setNextCursor(null);
    const load = async () => {
      try {
        const { ok, data } = await fetchJson<{
          packages?: SimilarPackage[];
          nextCursor?: string | null;
        }>(`${apiPaths.packages.similar}?${params}`, {
          signal: controller.signal,
          timeoutMs: 45_000,
          retries: 3,
        });
        if (controller.signal.aborted) return;
        setPackages(ok ? (data.packages ?? []) : []);
        setNextCursor(ok ? (data.nextCursor ?? null) : null);
      } catch {
        if (controller.signal.aborted) return;
        setPackages([]);
        setNextCursor(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, [packageName, ecosystem, keywordsKey, competitorsKey]);

  const loadMore = async () => {
    if (!packageName || !nextCursor || loadingMore) return;

    moreAbortRef.current?.abort();
    const controller = new AbortController();
    moreAbortRef.current = controller;

    const params = new URLSearchParams({
      package: packageName,
      ecosystem,
      cursor: nextCursor,
    });
    if (keywordsKey) params.set("keywords", keywordsKey);

    setLoadingMore(true);
    try {
      const { ok, data } = await fetchJson<{
        packages?: SimilarPackage[];
        nextCursor?: string | null;
      }>(`${apiPaths.packages.similar}?${params}`, {
        signal: controller.signal,
        timeoutMs: 45_000,
        retries: 2,
      });
      if (controller.signal.aborted) return;
      if (!ok) {
        setNextCursor(null);
        return;
      }
      const incoming = data.packages ?? [];
      setPackages((prev) => {
        const seen = new Set(prev.map((pkg) => pkg.name.toLowerCase()));
        return [
          ...prev,
          ...incoming.filter((pkg) => !seen.has(pkg.name.toLowerCase())),
        ];
      });
      setNextCursor(data.nextCursor ?? null);
    } catch {
      if (!controller.signal.aborted) setNextCursor(null);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  };

  const selectedKey = selected.join("\0");

  useEffect(() => {
    const names = selectedKey ? selectedKey.split("\0") : [];
    const missing = names.filter((name) => {
      const column = fetchedRef.current[name];
      return !column || column.status === "error";
    });
    if (missing.length === 0) return;

    const signal = compareAbortRef.current?.signal;
    setFetched((prev) =>
      missing.reduce(
        (acc, name) => ({
          ...acc,
          [name]: { name, status: "loading" as const },
        }),
        prev,
      ),
    );

    const loadOne = async (name: string) => {
      try {
        const { ok, data } = await fetchJson(
          `${apiPaths.analysis.metrics}?package=${encodeURIComponent(name)}&ecosystem=${ecosystem}`,
          {
            signal,
            timeoutMs: 60_000,
            retries: 2,
            retryDelayMs: 1500,
          },
        );
        if (signal?.aborted) return;
        if (!ok) {
          setFetched((prev) => ({
            ...prev,
            [name]: {
              name,
              status: "error",
              error: "Analysis failed",
            },
          }));
          return;
        }
        setFetched((prev) => ({
          ...prev,
          [name]: snapshotFromAnalysis(data, name),
        }));
      } catch {
        if (signal?.aborted) return;
        setFetched((prev) => ({
          ...prev,
          [name]: { name, status: "error", error: "Analysis failed" },
        }));
      }
    };

    void Promise.all(missing.slice(0, COMPARE_CAP).map(loadOne));
  }, [selectedKey, ecosystem]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((item) => item !== name);
      if (prev.length >= COMPARE_CAP) return prev;
      return [...prev, name];
    });
  };

  const compareColumns = useMemo(() => {
    if (!current || selected.length === 0) return [];
    const others = selected.map(
      (name) => fetched[name] ?? { name, status: "loading" as const },
    );
    return [current, ...others];
  }, [current, selected, fetched]);

  const atCap = selected.length >= COMPARE_CAP;

  if (loading) {
    return <RelatedPackagesSkeleton />;
  }

  if (packages.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          No related packages found.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
        {atCap && (
          <p className="mb-3 hidden text-xs text-gray-500 dark:text-gray-400 md:block">
            Compare up to 2 packages
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => {
            const checked = selected.includes(pkg.name);
            const disabled = atCap && !checked;
            const compareId = `compare-${pkg.name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
            return (
              <div
                key={pkg.name}
                className="rounded-lg border border-rule p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <Link
                      href={packagePagePath(ecosystem, pkg.name)}
                      scroll={false}
                      className="link font-mono font-semibold truncate"
                    >
                      {pkg.name}
                    </Link>
                  </div>
                  <label
                    htmlFor={compareId}
                    className={`hidden shrink-0 items-center gap-1.5 text-xs md:inline-flex ${
                      disabled
                        ? "cursor-not-allowed text-gray-400 dark:text-gray-400"
                        : "cursor-pointer text-gray-600 dark:text-gray-300"
                    }`}
                    title={
                      disabled
                        ? "Compare up to 2 packages"
                        : `Compare ${pkg.name}`
                    }
                  >
                    <input
                      id={compareId}
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(pkg.name)}
                      className="rounded border-gray-600 accent-signal disabled:opacity-40 dark:border-gray-400"
                    />
                    Compare
                  </label>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-1">
                  v{pkg.version}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                  {pkg.description}
                </p>
              </div>
            );
          })}
        </div>
        {nextCursor && selected.length === 0 && (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full sm:w-auto sm:min-w-[10rem] rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-signal disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {compareColumns.length > 1 && (
        <div className="hidden md:block">
          <PackageCompareTable
            columns={compareColumns}
            ecosystem={ecosystem}
            onClear={() => setSelected([])}
          />
        </div>
      )}
    </div>
  );
}
