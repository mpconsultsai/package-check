"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import semver from "semver";
import { fetchJson } from "@/lib/prefs/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import { PASTE_LIST_MAX_PACKAGES } from "@/lib/parse/parse-dependency-list";
import { parseDependencyListForEcosystem } from "@/lib/parse/parse-requirements";
import {
  packagePagePath,
  type PackageEcosystem,
} from "@/lib/packages/package-routes";
import { isNugetUpdateAvailable } from "@/lib/nuget/nuget-version";
import { describePypiSpec, isPypiUpdateAvailable } from "@/lib/pypi/pypi-version";
import { describeDependencySpec } from "@/lib/parse/describe-dependency-spec";
import { useWatchlistActions } from "@/lib/prefs/use-watchlist";
import type { WatchlistSummary } from "@/lib/prefs/watchlist-store";
import type { ClientAnalysisResponse } from "@/lib/packages/analysis-response";

type RowStatus = "pending" | "loading" | "done" | "error";

interface AnalysisRow {
  name: string;
  requested?: string;
  status: RowStatus;
  version?: string;
  updateAvailable?: boolean;
  vulnerabilityCount?: number;
  qualityScore?: number;
  deprecated?: boolean;
  error?: string;
  notFound?: boolean;
}

const CONCURRENCY = 3;

const badgeBase =
  "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

function summaryFromRow(row: AnalysisRow): WatchlistSummary {
  return {
    version: row.version,
    vulnerabilityCount: row.vulnerabilityCount,
    qualityScore: row.qualityScore,
    deprecated: row.deprecated,
  };
}

function isNotFoundError(message: string | undefined): boolean {
  if (!message) return false;
  return /not found/i.test(message);
}

/** True when npm latest is newer than the pasted constraint / locked version. */
export function isUpdateAvailable(
  requested: string | undefined,
  latest: string | undefined,
): boolean {
  if (!requested || !latest) return false;
  const spec = requested.trim();
  if (!spec || spec === "*" || spec === "latest") return false;
  if (/^(workspace|file|link|portal|git|http|https|ssh|github|gist|bitbucket|gitlab):/i.test(spec)) {
    return false;
  }

  const latestClean = semver.clean(latest) ?? (semver.valid(latest) ? latest : null);
  if (!latestClean) return false;

  const exact = semver.clean(spec) ?? (semver.valid(spec) ? spec : null);
  if (exact) return semver.gt(latestClean, exact);

  try {
    const min = semver.minVersion(spec);
    if (min) return semver.gt(latestClean, min.version);
  } catch {
    // ignore invalid ranges
  }
  return false;
}

function SpecifiedCell({
  requested,
  ecosystem,
}: {
  requested?: string;
  ecosystem: PackageEcosystem;
}) {
  if (!requested) return "-";
  const desc =
    ecosystem === "pypi"
      ? describePypiSpec(requested)
      : describeDependencySpec(requested);
  return (
    <span className="block">
      <span className="font-mono text-xs">{requested}</span>
      {desc && (
        <span className="mt-0.5 block text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          {desc.detail}
        </span>
      )}
    </span>
  );
}

function StatusBadge({ row }: { row: AnalysisRow }) {
  if (row.status === "pending") {
    return <span className="text-gray-500 dark:text-gray-400">Queued</span>;
  }
  if (row.status === "loading") {
    return <span className="text-gray-500 dark:text-gray-400">Analysing…</span>;
  }
  if (row.status === "done") {
    return (
      <span
        className={`${badgeBase} bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100`}
      >
        Done
      </span>
    );
  }
  if (row.notFound || isNotFoundError(row.error)) {
    return (
      <span
        className={`${badgeBase} bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100`}
      >
        Not Found
      </span>
    );
  }
  return (
    <span
      className={`${badgeBase} bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100`}
      title={row.error}
    >
      Error
    </span>
  );
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function statusLabel(row: AnalysisRow): string {
  if (row.status === "pending") return "Queued";
  if (row.status === "loading") return "Analysing";
  if (row.status === "done") return "Done";
  if (row.notFound || isNotFoundError(row.error)) return "Not Found";
  return row.error ? `Error: ${row.error}` : "Error";
}

function buildMarkdownReport(rows: AnalysisRow[]): string {
  const lines = [
    "# Package analysis",
    "",
    `Generated ${new Date().toISOString()}`,
    "",
    "| Package | Specified | Latest | Vulns | Quality | Status | Notes |",
    "| --- | --- | --- | ---: | ---: | --- | --- |",
  ];

  for (const row of rows) {
    const notes: string[] = [];
    if (row.deprecated) notes.push("deprecated");
    if (row.updateAvailable) notes.push("update available");
    lines.push(
      `| ${escapeMdCell(row.name)} | ${escapeMdCell(row.requested ?? "-")} | ${escapeMdCell(row.version ? `v${row.version}` : "-")} | ${typeof row.vulnerabilityCount === "number" ? String(row.vulnerabilityCount) : "-"} | ${typeof row.qualityScore === "number" ? `${row.qualityScore}/100` : "-"} | ${escapeMdCell(statusLabel(row))} | ${escapeMdCell(notes.join(", ") || "-")} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PasteListPanel({
  ecosystem = "npm",
}: {
  ecosystem?: PackageEcosystem;
}) {
  const headingId = useId();
  const textareaId = useId();
  const selectAllId = useId();
  const { add } = useWatchlistActions();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [meta, setMeta] = useState<{
    invalidCount: number;
    truncated: boolean;
    source: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      cancelledRef.current = true;
    };
  }, []);

  const selectableNames = useMemo(
    () => rows.filter((row) => row.status === "done").map((row) => row.name),
    [rows],
  );

  const selectedCount = useMemo(
    () => selectableNames.filter((name) => selected.has(name)).length,
    [selectableNames, selected],
  );

  const allSelected =
    selectableNames.length > 0 && selectedCount === selectableNames.length;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate =
      selectedCount > 0 && selectedCount < selectableNames.length;
  }, [selectedCount, selectableNames.length]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    stop();
    setText("");
    setRows([]);
    setSelected(new Set());
    setMeta(null);
    setDoneCount(0);
  }, [stop]);

  const toggleSelected = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (selectableNames.length === 0) return prev;
      const allOn = selectableNames.every((name) => prev.has(name));
      if (allOn) return new Set();
      return new Set(selectableNames);
    });
  };

  const analyseList = useCallback(async () => {
    const parsed = parseDependencyListForEcosystem(text, ecosystem);
    setMeta({
      invalidCount: parsed.invalidCount,
      truncated: parsed.truncated,
      source: parsed.source,
    });

    if (parsed.entries.length === 0) {
      setRows([]);
      setSelected(new Set());
      setDoneCount(0);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    setRunning(true);
    setDoneCount(0);
    setSelected(new Set());

    const initial: AnalysisRow[] = parsed.entries.map((entry) => ({
      name: entry.name,
      requested: entry.requested,
      status: "pending",
    }));
    setRows(initial);

    let cursor = 0;
    let completed = 0;

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, initial.length) },
      async () => {
        while (!cancelledRef.current) {
          const index = cursor++;
          if (index >= initial.length) return;
          const entry = initial[index];

          setRows((prev) =>
            prev.map((row, i) =>
              i === index ? { ...row, status: "loading" } : row,
            ),
          );

          try {
            const { ok, data } = await fetchJson<
              ClientAnalysisResponse & { error?: string }
            >(
              `${apiPaths.analysis.metrics}?package=${encodeURIComponent(entry.name)}&ecosystem=${ecosystem}`,
              {
                signal: controller.signal,
                timeoutMs: 60_000,
                retries: 2,
                retryDelayMs: 1500,
              },
            );

            if (cancelledRef.current || controller.signal.aborted) return;

            if (!ok) {
              const error = data?.error || "Analysis failed";
              setRows((prev) =>
                prev.map((row, i) =>
                  i === index
                    ? {
                        ...row,
                        status: "error",
                        error,
                        notFound: isNotFoundError(error),
                      }
                    : row,
                ),
              );
            } else {
              const latest = data?.packageInfo?.latestVersion as
                | string
                | undefined;
              setRows((prev) =>
                prev.map((row, i) =>
                  i === index
                    ? {
                        ...row,
                        status: "done",
                        version: latest,
                        updateAvailable:
                          ecosystem === "pypi"
                            ? isPypiUpdateAvailable(entry.requested, latest)
                            : ecosystem === "nuget"
                              ? isNugetUpdateAvailable(entry.requested, latest)
                              : isUpdateAvailable(entry.requested, latest),
                        vulnerabilityCount: data?.security?.totalCount,
                        qualityScore: data?.metrics?.qualityScore,
                        deprecated: Boolean(data?.npm?.deprecated),
                      }
                    : row,
                ),
              );
            }
          } catch (err: unknown) {
            if (controller.signal.aborted || cancelledRef.current) return;
            const error =
              err instanceof Error ? err.message : "Request failed";
            setRows((prev) =>
              prev.map((row, i) =>
                i === index
                  ? {
                      ...row,
                      status: "error",
                      error,
                      notFound: isNotFoundError(error),
                    }
                  : row,
              ),
            );
          }

          completed += 1;
          setDoneCount(completed);
        }
      },
    );

    await Promise.all(workers);
    if (!cancelledRef.current) setRunning(false);
  }, [text, ecosystem]);

  const doneRows = rows.filter((row) => row.status === "done");
  const updateCount = rows.filter((row) => row.updateAvailable).length;
  const selectedRows = doneRows.filter((row) => selected.has(row.name));

  const addSelectedToWatchlist = () => {
    for (const row of selectedRows) {
      add(row.name, summaryFromRow(row), ecosystem);
    }
  };

  const exportMarkdown = () => {
    const markdown = buildMarkdownReport(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadMarkdown(markdown, `package-analysis-${stamp}.md`);
  };

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor={textareaId}
          className="block text-sm font-medium text-ink"
        >
          {ecosystem === "pypi"
            ? "Analyse dependency file"
            : ecosystem === "nuget"
              ? "Analyse project file"
              : "Analyse package.json"}
        </label>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {ecosystem === "pypi"
            ? `requirements.txt, pyproject.toml, or PEP 508 lines (max ${PASTE_LIST_MAX_PACKAGES}).`
            : ecosystem === "nuget"
              ? `csproj PackageReference entries, or a list of package ids (max ${PASTE_LIST_MAX_PACKAGES}).`
              : `package.json, package-lock.json, yarn.lock, or a list of package names (max ${PASTE_LIST_MAX_PACKAGES}).`}
        </p>
        <textarea
          id={textareaId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={
            ecosystem === "pypi"
              ? "[project]\nname = \"my-app\"\ndependencies = [\n  \"requests>=2.28.0\",\n  \"django>=4.2,<5\",\n]\n\n# or requirements.txt lines:\n# numpy==1.26.4"
              : ecosystem === "nuget"
                ? "<Project>\n  <ItemGroup>\n    <PackageReference Include=\"Newtonsoft.Json\" Version=\"13.0.3\" />\n    <PackageReference Include=\"Serilog\" Version=\"4.0.0\" />\n  </ItemGroup>\n</Project>"
                : `{\n  "dependencies": {\n    "react": "^19.0.0",\n    "lodash": "^4.17.21"\n  }\n}`
          }
          className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-ink px-3 py-2 font-mono outline-none focus:border-blue-500 focus:ring-2 focus:ring-inset focus:ring-signal/30 dark:focus:border-blue-400"
          disabled={running}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void analyseList()}
          disabled={running || !text.trim()}
          className="inline-flex items-center rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper hover:bg-signal disabled:opacity-50"
        >
          {running ? "Analysing…" : "Analyse list"}
        </button>
        {running && (
          <button
            type="button"
            onClick={stop}
            className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
        )}
        {(text.trim() || rows.length > 0 || meta) && !running && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Reset
          </button>
        )}
        {rows.length > 0 && !running && (
          <button
            type="button"
            onClick={exportMarkdown}
            className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Export Markdown
          </button>
        )}
        {selectedRows.length > 0 && !running && (
          <button
            type="button"
            onClick={addSelectedToWatchlist}
            className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Add selected to watchlist ({selectedRows.length})
          </button>
        )}
      </div>

      {meta && rows.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No valid package names found
          {meta.invalidCount > 0 ? ` (${meta.invalidCount} invalid skipped)` : ""}.
        </p>
      )}

      {rows.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3
              id={headingId}
              className="text-sm font-medium text-ink"
            >
              Results
            </h3>
            <p
              className="text-xs text-gray-500 dark:text-gray-400"
              aria-live="polite"
            >
              {running
                ? `Analysed ${doneCount} of ${rows.length}`
                : `${doneRows.length} of ${rows.length} complete`}
              {!running && updateCount > 0
                ? ` · ${updateCount} update${updateCount === 1 ? "" : "s"} available`
                : ""}
              {meta?.truncated ? ` · capped at ${PASTE_LIST_MAX_PACKAGES}` : ""}
              {meta && meta.invalidCount > 0
                ? ` · ${meta.invalidCount} invalid skipped`
                : ""}
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-rule">
            <table
              className="min-w-full text-left text-sm"
              aria-labelledby={headingId}
            >
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="w-10 px-3 py-2 font-semibold">
                    <input
                      ref={selectAllRef}
                      id={selectAllId}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={running || selectableNames.length === 0}
                      className="rounded border-gray-300 accent-signal disabled:opacity-50"
                      aria-label="Select all analysed packages"
                      title="Select all"
                    />
                  </th>
                  <th className="px-3 py-2 font-semibold">Package</th>
                  <th className="px-3 py-2 font-semibold">Specified</th>
                  <th className="px-3 py-2 font-semibold">Latest</th>
                  <th className="px-3 py-2 font-semibold">Vulns</th>
                  <th className="px-3 py-2 font-semibold">Quality</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((row) => {
                  const canSelect = row.status === "done";
                  return (
                    <tr key={row.name} className="bg-white dark:bg-gray-800">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={canSelect && selected.has(row.name)}
                          onChange={() => toggleSelected(row.name)}
                          disabled={running || !canSelect}
                          className="rounded border-gray-300 accent-signal disabled:opacity-40"
                          aria-label={`Select ${row.name}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={packagePagePath(ecosystem, row.name)}
                          scroll={false}
                          className="link font-medium"
                        >
                          {row.name}
                        </Link>
                        {row.deprecated && (
                          <span className="ml-2 inline-flex rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-900 dark:bg-orange-900/40 dark:text-orange-100">
                            Deprecated
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        <SpecifiedCell
                          requested={row.requested}
                          ecosystem={ecosystem}
                        />
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        {row.version && row.version !== "Unknown" ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className="tabular-nums">v{row.version}</span>
                            {row.updateAvailable && (
                              <span className="inline-flex rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                                Update
                              </span>
                            )}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {typeof row.vulnerabilityCount === "number" ? (
                          <span
                            className={
                              row.vulnerabilityCount > 0
                                ? "font-medium text-red-700 dark:text-red-300"
                                : "text-gray-700 dark:text-gray-300"
                            }
                          >
                            {row.vulnerabilityCount}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 tabular-nums">
                        {typeof row.qualityScore === "number"
                          ? `${row.qualityScore}/100`
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge row={row} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
