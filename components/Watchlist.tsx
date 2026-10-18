"use client";

import Link from "next/link";
import semver from "semver";
import {
  useWatchlist,
  useWatchlistActions,
  useIsWatched,
} from "@/lib/prefs/use-watchlist";
import {
  getWatchlistAlerts,
  type WatchlistEntry,
} from "@/lib/prefs/watchlist-store";
import {
  packagePagePath,
  registryLabel,
  type PackageEcosystem,
} from "@/lib/packages/package-routes";

type VersionBumpKind = "major" | "minor" | "patch";

const versionBumpKind = (
  from: string,
  to: string,
): VersionBumpKind | null => {
  const prev = semver.valid(semver.clean(from));
  const next = semver.valid(semver.clean(to));
  if (!prev || !next) return null;
  const diff = semver.diff(prev, next);
  if (!diff) return null;
  if (diff === "major" || diff === "premajor") return "major";
  if (diff === "minor" || diff === "preminor") return "minor";
  return "patch";
};

const newVersionChip = (
  entry: WatchlistEntry,
): { label: string; className: string } | null => {
  const next = entry.fresh?.version;
  const prev = entry.summary?.version;
  if (!next) return null;

  const kind = prev && prev !== next ? versionBumpKind(prev, next) : null;
  const bump =
    kind === "major" ? "Major" : kind === "minor" ? "Minor" : kind === "patch" ? "Patch" : null;
  const label =
    prev && prev !== next
      ? bump
        ? `v${prev} → v${next} · ${bump}`
        : `v${prev} → v${next}`
      : `New v${next}`;

  return {
    label,
    className:
      kind === "major"
        ? "border-ink text-ink"
        : "border-emerald-600 text-emerald-800 dark:border-emerald-500 dark:text-emerald-300",
  };
};

function formatCheckedAt(ts?: number): string {
  if (!ts) return "Not checked yet";
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Checked just now";
  if (mins < 60) return `Checked ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `Checked ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${days}d ago`;
}

function statusLine(entry: WatchlistEntry): string {
  const parts: string[] = [];
  const version = entry.fresh?.version ?? entry.summary?.version;
  const vulns =
    entry.fresh?.vulnerabilityCount ?? entry.summary?.vulnerabilityCount;
  const deprecated = entry.fresh?.deprecated ?? entry.summary?.deprecated;

  if (version) parts.push(`v${version}`);
  if (typeof vulns === "number") {
    parts.push(vulns === 0 ? "No known vulns" : `${vulns} vuln${vulns === 1 ? "" : "s"}`);
  }
  if (deprecated) parts.push("Deprecated");
  if (typeof entry.summary?.qualityScore === "number") {
    parts.push(`Quality ${entry.summary.qualityScore}/100`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Open to analyse";
}

function AlertBadges({ entry }: { entry: WatchlistEntry }) {
  const alerts = getWatchlistAlerts(entry);
  const chips: { label: string; className: string }[] = [];
  if (alerts.newVersion) {
    const versionChip = newVersionChip(entry);
    if (versionChip) chips.push(versionChip);
  }
  if (alerts.newVulns) {
    const n = entry.fresh?.vulnerabilityCount ?? 0;
    chips.push({
      label: `${n} vuln${n === 1 ? "" : "s"}`,
      className:
        "border-red-600 text-red-800 dark:border-red-500 dark:text-red-300",
    });
  }
  if (alerts.newlyDeprecated) {
    chips.push({
      label: "Deprecated",
      className:
        "border-orange-600 text-orange-800 dark:border-orange-500 dark:text-orange-300",
    });
  }

  if (chips.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`inline-flex border px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${chip.className}`}
        >
          {chip.label}
        </span>
      ))}
    </span>
  );
}

export function WatchlistSection({
  embedded = false,
  checking = false,
  ecosystem = "npm",
}: {
  /** Compact list for the search-card Watchlist panel */
  embedded?: boolean;
  checking?: boolean;
  /** Show only packages from this registry. */
  ecosystem?: PackageEcosystem;
}) {
  const entries = useWatchlist().filter(
    (entry) => (entry.ecosystem ?? "npm") === ecosystem,
  );
  const { remove } = useWatchlistActions();
  const registry = registryLabel(ecosystem);

  if (entries.length === 0) {
    if (!embedded) return null;
    return (
      <p className="py-1 text-sm text-gray-600 dark:text-gray-400">
        No {registry} packages watched yet. Use Watch on a {registry} package
        page to save it here.
      </p>
    );
  }

  const list = (
    <ul
      className={
        embedded
          ? "divide-y divide-rule"
          : "divide-y divide-rule border-y border-rule"
      }
    >
      {checking && (
        <li
          className="py-2 font-mono text-xs text-gray-600 dark:text-gray-400"
          role="status"
          aria-live="polite"
        >
          Checking for updates…
        </li>
      )}
      {entries.map((entry) => (
        <li
          key={`${entry.ecosystem ?? "npm"}:${entry.name}`}
          className={`flex items-center gap-3 py-3 ${
            embedded ? "first:pt-1 last:pb-1" : ""
          }`}
        >
          <Link
            href={packagePagePath(entry.ecosystem ?? "npm", entry.name)}
            scroll={false}
            className="group min-w-0 flex-1"
          >
            <p className="truncate font-mono text-sm font-medium">
              <span className="text-ink underline decoration-gray-400 underline-offset-4 group-hover:decoration-signal">
                {entry.name}
              </span>
            </p>
            <p className="mt-1 truncate text-xs text-gray-600 dark:text-gray-400">
              {statusLine(entry)}
              <span className="mx-1.5 text-gray-400 dark:text-gray-400">·</span>
              {formatCheckedAt(entry.lastCheckedAt)}
            </p>
            <AlertBadges entry={entry} />
          </Link>
          <button
            type="button"
            onClick={() => remove(entry.name, entry.ecosystem ?? "npm")}
            title={`Remove ${entry.name} from watchlist`}
            aria-label={`Remove ${entry.name} from watchlist`}
            className="shrink-0 py-1 text-xs text-gray-600 underline decoration-gray-400 underline-offset-4 transition-colors hover:text-red-700 hover:decoration-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal dark:text-gray-400 dark:hover:text-red-400"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );

  if (embedded) return list;

  return (
    <section className="mb-4 sm:mb-8" aria-labelledby="watchlist-heading">
      <div className="mb-3">
        <h2
          id="watchlist-heading"
          className="text-lg sm:text-xl font-semibold text-ink"
        >
          My watchlist
        </h2>
      </div>
      {list}
    </section>
  );
}

export function WatchToggle({
  packageName,
  ecosystem = "npm",
  summary,
  disabled = false,
}: {
  packageName: string;
  ecosystem?: import("@/lib/packages/package-routes").PackageEcosystem;
  summary?: import("@/lib/prefs/watchlist-store").WatchlistSummary;
  disabled?: boolean;
}) {
  const watched = useIsWatched(packageName, ecosystem);
  const { toggle } = useWatchlistActions();

  if (!packageName) return null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => toggle(packageName, summary, ecosystem)}
      aria-pressed={watched}
      className="inline-flex items-center gap-1.5 border border-ink px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ink hover:text-paper disabled:opacity-50 dark:border-gray-300"
    >
      <svg
        className={`h-4 w-4 transition-colors ${
          watched
            ? "fill-amber-400 text-amber-400"
            : "fill-none text-gray-500 dark:text-gray-400"
        }`}
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
        />
      </svg>
      {watched ? "Watching" : "Watch"}
    </button>
  );
}
