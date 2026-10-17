"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { fetchJson, friendlyFetchError } from "@/lib/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import { packagePagePath } from "@/lib/package-routes";

type DependentRow = {
  name: string;
  description: string;
  version: string;
  downloads: number | null;
};

function formatDownloads(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return n.toLocaleString();
}

interface DependentsModalProps {
  packageName: string;
  dependentCount?: number;
  open: boolean;
  onClose: () => void;
}

export function DependentsModal({
  packageName,
  dependentCount,
  open,
  onClose,
}: DependentsModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [packages, setPackages] = useState<DependentRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (nextPage: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }

      try {
        const { ok, data } = await fetchJson<{
          packages?: DependentRow[];
          hasMore?: boolean;
          page?: number;
          error?: string;
        }>(
          `${apiPaths.packages.dependents}?package=${encodeURIComponent(packageName)}&page=${nextPage}`,
          { signal: controller.signal, timeoutMs: 55_000 },
        );

        if (!ok) {
          throw new Error(data.error || "Failed to load dependents");
        }

        const rows = data.packages ?? [];
        setPackages((prev) => {
          const merged = append ? [...prev, ...rows] : rows;
          return [...merged].sort((a, b) => {
            const da = a.downloads ?? -1;
            const db = b.downloads ?? -1;
            if (db !== da) return db - da;
            return a.name.localeCompare(b.name);
          });
        });
        setHasMore(Boolean(data.hasMore));
        setPage(data.page ?? nextPage);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(friendlyFetchError(err));
        if (!append) setPackages([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [packageName],
  );

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }

    setPackages([]);
    setPage(1);
    setHasMore(false);
    void loadPage(1, false);
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      abortRef.current?.abort();
    };
  }, [open, packageName, loadPage, onClose]);

  if (!open) return null;

  const npmBrowseUrl = `https://www.npmjs.com/browse/depended/${encodeURIComponent(packageName)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 dark:bg-black/60"
        aria-label="Close dependents dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-xl sm:rounded-xl bg-white dark:bg-gray-800 shadow-xl border border-rule"
      >
        <div className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold text-ink"
            >
              Dependents
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400 truncate">
              Packages that depend on{" "}
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {packageName}
              </span>
              {dependentCount !== undefined
                ? ` · ${dependentCount.toLocaleString()} on npm`
                : null}
              {" · sorted by downloads"}
            </p>
            <a
              href={npmBrowseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="link mt-1.5 inline-block text-xs"
            >
              View all on npm
            </a>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          {loading && (
            <div className="space-y-3" role="status">
              <span className="sr-only">Loading dependents</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse space-y-2 py-1">
                  <div className="h-4 w-2/5 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-4/5 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {!loading && !error && packages.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No dependents found in the public index.
            </p>
          )}

          {!loading && packages.length > 0 && (
            <ul className="divide-y divide-rule">
              {packages.map((pkg) => (
                <li key={pkg.name} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={packagePagePath("npm", pkg.name)}
                      className="link font-mono text-sm font-semibold truncate"
                      onClick={onClose}
                    >
                      {pkg.name}
                    </Link>
                    {pkg.downloads != null && (
                      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                        {formatDownloads(pkg.downloads)}/mo
                      </span>
                    )}
                  </div>
                  {pkg.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-2">
                      {pkg.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasMore && !error && (
          <div className="border-t border-rule px-4 py-3 sm:px-5">
            <button
              type="button"
              disabled={loadingMore || loading}
              onClick={() => void loadPage(page + 1, true)}
              className="w-full sm:w-auto sm:min-w-[10rem] sm:mx-auto sm:block rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-signal disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
