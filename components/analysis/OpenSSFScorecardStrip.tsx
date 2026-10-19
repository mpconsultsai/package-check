"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchJson } from "@/lib/prefs/fetch-client";
import { apiPaths } from "@/lib/api/paths";
import { compareScorecardChecks } from "@/lib/data-fetchers/openssf-scorecard";
import { scorecardImprovement } from "@/lib/packages/scorecard-remediation";

type ScorecardCheck = {
  name: string;
  score: number;
  reason: string;
  documentationUrl?: string;
};

type ScorecardPayload = {
  projectId: string;
  overallScore: number | null;
  scoredAt: string | null;
  checks: ScorecardCheck[];
  scorecardViewerUrl: string;
  depsDevProjectUrl: string;
  error?: string;
};

const PREVIEW_CHECK_COUNT = 3;

function scoreTone(score: number): string {
  if (score < 0) {
    return "bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300";
  }
  if (score >= 7) {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100";
  }
  if (score >= 4) {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100";
  }
  return "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100";
}

function formatScore(score: number): string {
  if (score < 0) return "N/A";
  return String(score);
}

function ScorecardAbout() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        <strong className="font-medium text-gray-700 dark:text-gray-300">
          OpenSSF Scorecard
        </strong>{" "}
        scores the linked GitHub repo&apos;s maintainer practices (0–10), not
        package security advisories alone.{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="link font-medium"
        >
          What is this?
        </button>
      </p>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-gray-200 bg-gray-50/80 px-2.5 py-2 text-xs leading-relaxed text-gray-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
      <p>
        Automated assessment from the{" "}
        <a
          href="https://openssf.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="link"
        >
          OpenSSF
        </a>
        : code review, branch protection, dependency pinning, security policy,
        CI safety, and similar checks on the repository behind this package.
      </p>
      <p className="mt-1.5">
        Use with the Security tab: advisories show{" "}
        <span className="italic">known vulns</span>; Scorecard shows{" "}
        <span className="italic">how the project is run</span>.{" "}
        <a
          href="https://scorecard.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="link"
        >
          scorecard.dev
        </a>
        {" · "}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-medium text-gray-700 dark:text-gray-300"
        >
          Hide
        </button>
      </p>
    </div>
  );
}

function ScorecardImprove({ checks }: { checks: ScorecardCheck[] }) {
  const [open, setOpen] = useState(false);
  const low = checks
    .filter((check) => check.score >= 0 && check.score < 5)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  if (low.length === 0) return null;

  return (
    <div className="border-t border-rule pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="scorecard-improvements"
        onClick={() => setOpen((value) => !value)}
        className="link text-[11px] font-medium"
      >
        {open
          ? "Hide how to raise scores under 5"
          : `How to raise scores under 5 (${low.length})`}
      </button>
      {open ? (
        <div id="scorecard-improvements" className="mt-2">
          <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            If this is your repository, these are the OpenSSF steps that move a
            score under 5.
          </p>
          <ul className="mt-1">
            {low.map((check) => (
              <li
                key={check.name}
                className="border-b border-rule py-1.5 text-xs last:border-0"
              >
                <span className="flex items-baseline justify-between gap-2">
                  {check.documentationUrl ? (
                    <a
                      href={check.documentationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link"
                    >
                      {check.name}
                    </a>
                  ) : (
                    <span className="text-ink">{check.name}</span>
                  )}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${scoreTone(check.score)}`}
                  >
                    {formatScore(check.score)}
                  </span>
                </span>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {scorecardImprovement(check.name)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CheckRow({
  check,
  showReason,
}: {
  check: ScorecardCheck;
  showReason: boolean;
}) {
  const label = check.documentationUrl ? (
    <a
      href={check.documentationUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="link"
    >
      {check.name}
    </a>
  ) : (
    <span className="text-gray-800 dark:text-gray-200">{check.name}</span>
  );

  return (
    <li className="flex items-center justify-between gap-2 py-1 border-b border-rule last:border-0 text-xs">
      <div className="min-w-0 flex-1 truncate" title={check.name}>
        {label}
        {showReason && check.reason ? (
          <p className="mt-0.5 line-clamp-2 whitespace-normal text-[11px] text-gray-500 dark:text-gray-400">
            {check.reason}
          </p>
        ) : null}
      </div>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${scoreTone(check.score)}`}
      >
        {formatScore(check.score)}
      </span>
    </li>
  );
}

export function OpenSSFScorecardStrip({
  packageName,
  repository,
}: {
  packageName: string;
  repository?: string | null;
  /** Reserved for nested layout (Package info tab) */
  embedded?: boolean;
}) {
  const [data, setData] = useState<ScorecardPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(repository?.trim()));
  const [error, setError] = useState<string | null>(null);
  const [checksExpanded, setChecksExpanded] = useState(false);

  useEffect(() => {
    if (!repository?.trim()) {
      setData(null);
      setLoading(false);
      setError(null);
      setChecksExpanded(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    setChecksExpanded(false);

    const params = new URLSearchParams({
      package: packageName,
      repository,
    });

    void fetchJson<ScorecardPayload>(
      `${apiPaths.packages.scorecard}?${params}`,
      { signal: controller.signal, timeoutMs: 45_000, retries: 1 },
    )
      .then(({ ok, data: payload, status }) => {
        if (controller.signal.aborted) return;
        if (!ok || payload.error) {
          setError(
            payload.error ||
              (status === 404
                ? "No scorecard for this repository"
                : "Could not load scorecard"),
          );
          return;
        }
        setData(payload);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Could not load scorecard");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [packageName, repository]);

  const orderedChecks = useMemo(
    () => (data ? [...data.checks].sort(compareScorecardChecks) : []),
    [data],
  );
  const previewChecks = orderedChecks
    .filter((check) => check.score >= 0)
    .slice(0, PREVIEW_CHECK_COUNT);

  const visibleChecks = checksExpanded ? orderedChecks : previewChecks;
  const extraChecks =
    data && !checksExpanded
      ? Math.max(0, data.checks.length - previewChecks.length)
      : 0;

  const shell = (body: ReactNode) => (
    <>
      <ScorecardAbout />
      {body}
    </>
  );

  if (!repository?.trim()) {
    return shell(
      <p className="text-xs text-gray-500 dark:text-gray-400">
        No GitHub repository in package metadata - Scorecard needs a public repo URL.
      </p>,
    );
  }

  if (loading) {
    return shell(
      <div className="animate-pulse space-y-2" role="status">
        <span className="sr-only">Loading OpenSSF Scorecard</span>
        <div className="flex gap-3">
          <div className="h-8 w-16 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-8 flex-1 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="h-20 rounded bg-gray-200 dark:bg-gray-700" />
      </div>,
    );
  }

  if (error) {
    return shell(
      <p className="text-xs text-gray-500 dark:text-gray-400">{error}</p>,
    );
  }

  if (!data) return null;

  const overall =
    data.overallScore != null ? data.overallScore.toFixed(1) : "-";
  const scoredDate = data.scoredAt
    ? new Date(data.scoredAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return shell(
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`rounded-md px-2.5 py-1 text-base font-bold tabular-nums ${scoreTone(
            data.overallScore ?? -1,
          )}`}
        >
          {overall}
          <span className="text-xs font-normal opacity-80"> / 10</span>
        </span>
        <p className="min-w-0 flex-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="font-mono">{data.projectId}</span>
          {scoredDate ? <> · scored {scoredDate}</> : null}
          {" · "}
          <a
            href={data.scorecardViewerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            Viewer
          </a>
        </p>
        {data.checks.length > PREVIEW_CHECK_COUNT || checksExpanded ? (
          <button
            type="button"
            onClick={() => setChecksExpanded((v) => !v)}
            aria-expanded={checksExpanded}
            className="link shrink-0 text-[11px] font-medium"
          >
            {checksExpanded
              ? "Fewer checks"
              : extraChecks > 0
                ? `All ${data.checks.length} checks`
                : "All checks"}
          </button>
        ) : null}
      </div>

      {visibleChecks.length > 0 ? (
        <ul className={checksExpanded ? "max-h-64 overflow-y-auto pr-0.5" : ""}>
          {visibleChecks.map((check) => (
            <CheckRow
              key={check.name}
              check={check}
              showReason={checksExpanded}
            />
          ))}
        </ul>
      ) : null}
      <ScorecardImprove checks={orderedChecks} />
    </div>,
  );
}
