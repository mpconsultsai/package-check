"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import semver from "semver";
import { fetchJson } from "@/lib/prefs/fetch-client";
import { formatPublishDate } from "@/lib/utils/format";
import {
  buildUpgradeAdvice,
  listStableVersions,
  type UpgradeAdvice,
  type UpgradeVerdict,
} from "@/lib/upgrade/upgrade-advisor";
import { advisoryStillAffects } from "@/lib/upgrade/upgrade-manifest";
import type { RangedRelease } from "@/lib/upgrade/upgrade-release-notes";
import type {
  BreakingReleaseNote,
  PeerChange,
} from "@/lib/upgrade/upgrade-release-notes";
import { LinkifiedText } from "@/components/LinkifiedText";
import { useLiveMessage } from "@/components/LiveAnnouncer";
import { SelectField } from "@/components/SelectField";
import { AgentGraphSteps } from "@/components/analysis/AgentGraphSteps";
import {
  ArrowPathIcon,
  MinusIcon,
  PlusIcon,
} from "@/components/icons";
import { severityBadgeClass } from "@/lib/utils/severity";
import { apiPaths } from "@/lib/api/paths";
import { UPGRADE_AGENT_GENERIC_ERROR } from "@/lib/ai/upgrade-agent-messages";
import { consumeUpgradeAgentSse } from "@/lib/upgrade/upgrade-agent-stream-client";
import { checkNodeAgainstTargetEngines } from "@/lib/packages/node-engine-check";
import {
  npmReleaseCooldownCaution,
  npmReleaseCooldownStatus,
} from "@/lib/packages/npm-release-cooldown";
import { useNpmReleaseCooldownHours } from "@/lib/prefs/use-npm-release-cooldown-pref";
import { useNodeRuntimePref } from "@/lib/prefs/use-node-runtime-pref";
import {
  getNodeRuntimeVersion,
  parseNodeRuntimeVersion,
} from "@/lib/prefs/node-runtime-pref";
import { fetchLatestNodeLts } from "@/lib/data-fetchers/nodejs-releases";
import { packagePagePath } from "@/lib/packages/package-routes";
import {
  peerRangePartLabel,
  summarizePeerRangeChange,
} from "@/lib/upgrade/peer-range-diff";

const VERSION_OPTIONS = 40;

type AgentBrief = {
  headline: string;
  bullets: string[];
  risk: "low" | "moderate" | "high";
  nextSteps: string[];
  watchFor?: string[];
};

interface UpgradeDetailsPayload {
  error?: string;
  github?: {
    owner: string;
    repo: string;
    directory?: string | null;
    compareUrl: string | null;
    releasesUrl?: string | null;
    changelogUrl?: string | null;
  } | null;
  breaking?: {
    notes: BreakingReleaseNote[];
    matchedReleases: number;
    scannedReleases: number;
    changelogVersions?: number;
    source?: "changelog" | "github-releases" | "mixed" | "none";
    hasNotes: boolean;
  };
  peers?: {
    available: boolean;
    changes: PeerChange[];
  };
  manifest?: UpgradeManifestPayload | null;
  releases?: {
    total: number;
    shown: RangedRelease[];
  };
}

interface SecuritySummary {
  totalCount?: number;
  critical?: number;
  high?: number;
  moderate?: number;
  low?: number;
  vulnerabilities?: UpgradeAdvisory[];
}

interface UpgradeAdvisory {
  id: string;
  title: string;
  severity: string;
  url?: string;
  cveId?: string | null;
  vulnerableVersionRange?: string | null;
  patchedVersions?: string | null;
}

interface UpgradeManifestPayload {
  available: boolean;
  deprecation: { from: string | null; to: string | null };
  moduleType: { from: string | null; to: string | null } | null;
  engines: PeerChange[];
  dependencies: PeerChange[];
  dependencyCount: number;
}

function verdictStyles(verdict: UpgradeVerdict): string {
  switch (verdict) {
    case "current":
      return "border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-50";
    case "patch":
      return "border-sky-200 bg-sky-50/80 text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-50";
    case "minor":
      return "border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-50";
    case "major":
      return "border-orange-200 bg-orange-50/80 text-orange-950 dark:border-orange-800/50 dark:bg-orange-950/30 dark:text-orange-50";
    default:
      return "border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-100";
  }
}

function bumpLabel(advice: UpgradeAdvice): string | null {
  if (advice.bump === "same") return "Up to date";
  if (advice.bump === "major") return "Major";
  if (advice.bump === "minor") return "Minor";
  if (advice.bump === "patch") return "Patch";
  return null;
}

function peerChangeLabel(kind: PeerChange["kind"]): string {
  if (kind === "added") return "Added";
  if (kind === "removed") return "Removed";
  return "Changed";
}

function PeerChangeKindIcon({ kind }: { kind: PeerChange["kind"] }) {
  const label = peerChangeLabel(kind);
  const badge =
    kind === "added"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200"
      : kind === "removed"
        ? "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200"
        : "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100";
  const Icon =
    kind === "added" ? PlusIcon : kind === "removed" ? MinusIcon : ArrowPathIcon;

  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${badge}`}
      title={label}
      aria-hidden="true"
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

/** Short note only — majors dropped/added, not a second copy of the range. */
function peerChangeImpact(change: PeerChange): string | null {
  if (change.kind !== "changed") return null;
  const summary = summarizePeerRangeChange(change.from, change.to);
  if (summary.dropped.length > 0) {
    const majors = [
      ...new Set(summary.dropped.map((part) => peerRangePartLabel(part))),
    ];
    return `Drops ${majors.join(", ")}`;
  }
  if (summary.added.length > 0) {
    const majors = [
      ...new Set(summary.added.map((part) => peerRangePartLabel(part))),
    ];
    return `Adds ${majors.join(", ")}`;
  }
  if (summary.narrowed) return "Narrowed";
  return null;
}

function peerChangeRange(change: PeerChange): string {
  if (change.kind === "changed") return `${change.from} → ${change.to}`;
  if (change.kind === "added") return change.range;
  return change.range;
}

const NON_PACKAGE_ENGINE_NAMES = new Set([
  "node",
  "npm",
  "yarn",
  "pnpm",
  "bun",
  "deno",
]);

function isLinkableNpmPackage(name: string): boolean {
  return !NON_PACKAGE_ENGINE_NAMES.has(name.trim().toLowerCase());
}

const PEER_CHANGE_GROUPS: Array<{
  kind: PeerChange["kind"];
  label: string;
}> = [
  { kind: "removed", label: "Removed" },
  { kind: "changed", label: "Changed" },
  { kind: "added", label: "Added" },
];

function groupPeerChanges(changes: PeerChange[]) {
  return PEER_CHANGE_GROUPS.map(({ kind, label }) => {
    const items = changes
      .filter((change) => change.kind === kind)
      .sort((a, b) => {
        if (kind === "changed") {
          const aDrop = peerChangeImpact(a)?.startsWith("Drops") ? 0 : 1;
          const bDrop = peerChangeImpact(b)?.startsWith("Drops") ? 0 : 1;
          if (aDrop !== bDrop) return aDrop - bDrop;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    return { kind, label, items };
  }).filter((group) => group.items.length > 0);
}

function PeerChangePackageName({ name }: { name: string }) {
  if (!isLinkableNpmPackage(name)) {
    return <span className="font-mono text-xs sm:text-sm">{name}</span>;
  }
  return (
    <Link
      href={packagePagePath("npm", name)}
      scroll={false}
      className="link font-mono text-xs sm:text-sm"
    >
      {name}
    </Link>
  );
}

function PeerChangeTable({
  changes,
  caption,
}: {
  changes: PeerChange[];
  caption: string;
}) {
  const groups = groupPeerChanges(changes);
  return (
    <div className="space-y-2.5" aria-label={caption}>
      {groups.map((group) => (
        <section
          key={group.kind}
          className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
          aria-label={`${group.label}, ${group.items.length}`}
        >
          <header className="flex items-center gap-2 border-b border-black/10 bg-black/[0.03] px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
            <PeerChangeKindIcon kind={group.kind} />
            <h4 className="text-xs font-semibold tracking-wide text-ink">
              {group.label}
            </h4>
            <span className="text-[11px] tabular-nums opacity-50">
              {group.items.length}
            </span>
          </header>
          <ul className="divide-y divide-black/10 dark:divide-white/10">
            {group.items.map((change) => {
              const impact = peerChangeImpact(change);
              return (
                <li
                  key={`${change.kind}:${change.name}`}
                  className="px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <PeerChangePackageName name={change.name} />
                    {impact ? (
                      <span className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                        {impact}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 break-all font-mono text-[11px] leading-snug opacity-60">
                    {peerChangeRange(change)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function moduleFormatLabel(value: string | null): string {
  if (value === "module") return "ES module";
  if (value === "commonjs") return "CommonJS";
  return "Unspecified";
}

function formatVulnCount(security: SecuritySummary | null | undefined): string {
  if (!security || typeof security.totalCount !== "number") return "-";
  if (security.totalCount === 0) return "none";
  return String(security.totalCount);
}

export function UpgradeAdvisorPanel({
  packageName,
  latestVersion,
  versionTimes,
  latestSecurity,
}: {
  packageName: string;
  latestVersion?: string;
  versionTimes?: Record<string, string> | null;
  latestSecurity?: SecuritySummary | null;
}) {
  const versions = useMemo(
    () => listStableVersions(versionTimes).slice(0, VERSION_OPTIONS),
    [versionTimes],
  );

  const latest =
    latestVersion && latestVersion !== "Unknown" ? latestVersion : versions[0];

  const cooldownHours = useNpmReleaseCooldownHours();
  const { version: nodeRuntime, setVersion: setNodeRuntime } =
    useNodeRuntimePref();
  const [nodeDraft, setNodeDraft] = useState("");
  const [latestNodeLts, setLatestNodeLts] = useState<string | null>(null);

  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion] = useState("");
  /** Applied range — fetches run only after Check upgrade. */
  const [checkedRange, setCheckedRange] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [details, setDetails] = useState<UpgradeDetailsPayload | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [fromSecurity, setFromSecurity] = useState<SecuritySummary | null>(
    null,
  );
  const [fromSecurityLoading, setFromSecurityLoading] = useState(false);
  const [toSecurity, setToSecurity] = useState<SecuritySummary | null>(null);
  const [toSecurityLoading, setToSecurityLoading] = useState(false);
  const [agentBrief, setAgentBrief] = useState<AgentBrief | null>(null);
  const [agentModel, setAgentModel] = useState<string | null>(null);
  const [agentTools, setAgentTools] = useState<string[]>([]);
  const [agentStage, setAgentStage] = useState<string | null>(null);
  const [agentCached, setAgentCached] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);
  const changeNotesRef = useRef<HTMLDetailsElement | null>(null);

  const checkedFrom = checkedRange?.from ?? "";
  const checkedTo = checkedRange?.to ?? "";

  const resetAgentState = () => {
    setAgentBrief(null);
    setAgentModel(null);
    setAgentTools([]);
    setAgentStage(null);
    setAgentCached(false);
    setAgentError(null);
  };

  const clearResults = () => {
    setCheckedRange(null);
    setDetails(null);
    setDetailsError(null);
    setDetailsLoading(false);
    setFromSecurity(null);
    setFromSecurityLoading(false);
    setToSecurity(null);
    setToSecurityLoading(false);
    resetAgentState();
    setAgentLoading(false);
  };

  useEffect(() => {
    setFromVersion("");
    setToVersion(latest ?? "");
    clearResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on package/latest only
  }, [packageName, latest]);

  const nodeSeededRef = useRef(false);

  useEffect(() => {
    setNodeDraft(nodeRuntime);
  }, [nodeRuntime]);

  // Resolve latest Node LTS from nodejs.org for the default runtime.
  useEffect(() => {
    let cancelled = false;
    void fetchLatestNodeLts()
      .then((version) => {
        if (cancelled || !version) return;
        setLatestNodeLts(version);
      })
      .catch(() => {
        /* keep empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed Node once after localStorage hydrate when the user has no preference.
  useEffect(() => {
    if (nodeSeededRef.current || !latestNodeLts) return;
    let cancelled = false;
    // Pref subscribe hydrates on a microtask; run after that so we don't
    // overwrite a saved runtime before storage is read.
    queueMicrotask(() => {
      if (cancelled || nodeSeededRef.current) return;
      nodeSeededRef.current = true;
      if (getNodeRuntimeVersion()) return;
      setNodeDraft(latestNodeLts);
      setNodeRuntime(latestNodeLts);
    });
    return () => {
      cancelled = true;
    };
  }, [latestNodeLts, setNodeRuntime]);

  const advice = useMemo(() => {
    if (!checkedFrom || !checkedTo) return null;
    return buildUpgradeAdvice({
      from: checkedFrom,
      to: checkedTo,
      versionTimes,
      versions: listStableVersions(versionTimes),
    });
  }, [checkedFrom, checkedTo, versionTimes]);

  useEffect(() => {
    if (!checkedFrom || !checkedTo || checkedFrom === checkedTo) {
      setDetails(null);
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetailsLoading(true);
    setDetailsError(null);

    void fetchJson<UpgradeDetailsPayload>(
      `${apiPaths.upgrade.details}?package=${encodeURIComponent(packageName)}&from=${encodeURIComponent(checkedFrom)}&to=${encodeURIComponent(checkedTo)}`,
      {
        signal: controller.signal,
        timeoutMs: 45_000,
        retries: 1,
      },
    )
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        if (!ok) {
          setDetailsError(data.error || "Could not load upgrade details");
          setDetails(null);
          return;
        }
        setDetails(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailsError("Could not load upgrade details");
          setDetails(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailsLoading(false);
      });

    return () => controller.abort();
  }, [packageName, checkedFrom, checkedTo]);

  useEffect(() => {
    if (!checkedFrom || checkedFrom === checkedTo) {
      setFromSecurity(null);
      setFromSecurityLoading(false);
      return;
    }

    const controller = new AbortController();
    setFromSecurityLoading(true);

    void fetchJson<{ security?: SecuritySummary; error?: string }>(
      `${apiPaths.packages.security}?package=${encodeURIComponent(packageName)}&version=${encodeURIComponent(checkedFrom)}`,
      {
        signal: controller.signal,
        timeoutMs: 45_000,
        retries: 1,
      },
    )
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        setFromSecurity(ok && data.security ? data.security : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFromSecurity(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFromSecurityLoading(false);
      });

    return () => controller.abort();
  }, [packageName, checkedFrom, checkedTo]);

  useEffect(() => {
    if (!checkedTo) {
      setToSecurity(null);
      setToSecurityLoading(false);
      return;
    }
    if (checkedTo === latest && latestSecurity) {
      setToSecurity(latestSecurity);
      setToSecurityLoading(false);
      return;
    }

    const controller = new AbortController();
    setToSecurityLoading(true);

    void fetchJson<{ security?: SecuritySummary; error?: string }>(
      `${apiPaths.packages.security}?package=${encodeURIComponent(packageName)}&version=${encodeURIComponent(checkedTo)}`,
      {
        signal: controller.signal,
        timeoutMs: 45_000,
        retries: 1,
      },
    )
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        setToSecurity(ok && data.security ? data.security : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setToSecurity(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setToSecurityLoading(false);
      });

    return () => controller.abort();
  }, [packageName, checkedTo, latest, latestSecurity]);

  const runAgentBrief = async (opts?: {
    force?: boolean;
    signal?: AbortSignal;
  }) => {
    if (!checkedFrom || !checkedTo || checkedFrom === checkedTo) return;
    const force = opts?.force === true;
    const signal = opts?.signal;

    setAgentLoading(true);
    setAgentError(null);
    setAgentStage("collect");
    setAgentCached(false);
    if (force) {
      setAgentBrief(null);
      setAgentTools([]);
      setAgentModel(null);
    }

    try {
      const response = await fetch(apiPaths.upgrade.agent, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          packageName,
          from: checkedFrom,
          to: checkedTo,
          stream: true,
          force,
          runtimeNode: nodeRuntime || undefined,
          cooldownHours,
        }),
        signal,
      });

      if (!response.ok) {
        if (signal?.aborted) return;
        setAgentBrief(null);
        setAgentError(UPGRADE_AGENT_GENERIC_ERROR);
        return;
      }

      let sawBrief = false;
      let sawError = false;

      await consumeUpgradeAgentSse(
        response,
        (event) => {
          if (signal?.aborted) return;
          if (event.type === "status") {
            setAgentStage(event.stage);
            return;
          }
          if (event.type === "tools") {
            setAgentTools(event.toolCalls);
            return;
          }
          if (event.type === "brief") {
            sawBrief = true;
            setAgentBrief(event.brief);
            return;
          }
          if (event.type === "done") {
            setAgentModel(event.model);
            setAgentTools(event.toolCalls);
            setAgentCached(event.cached);
            setAgentStage(null);
            return;
          }
          if (event.type === "error") {
            sawError = true;
            setAgentBrief(null);
            setAgentError(event.message || UPGRADE_AGENT_GENERIC_ERROR);
            setAgentStage(null);
          }
        },
        signal,
      );

      if (signal?.aborted) return;
      if (!sawBrief && !sawError) {
        setAgentError(UPGRADE_AGENT_GENERIC_ERROR);
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAgentBrief(null);
      setAgentError(UPGRADE_AGENT_GENERIC_ERROR);
    } finally {
      if (!signal?.aborted) {
        setAgentLoading(false);
        setAgentStage(null);
      }
    }
  };

  const hasChangeDetail =
    (details?.releases?.total ?? 0) > 0 ||
    (details?.breaking?.notes.length ?? 0) > 0 ||
    (details?.manifest?.dependencyCount ?? 0) > 0 ||
    (details?.peers?.changes.length ?? 0) > 0;

  useEffect(() => {
    if (changeNotesRef.current && hasChangeDetail) {
      changeNotesRef.current.open = true;
    }
  }, [packageName, checkedFrom, checkedTo, details, hasChangeDetail]);

  // Drop stale results when the draft range changes away from the last check.
  useEffect(() => {
    if (!checkedRange) return;
    if (
      fromVersion === checkedRange.from &&
      toVersion === checkedRange.to
    ) {
      return;
    }
    agentAbortRef.current?.abort();
    agentAbortRef.current = null;
    clearResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional draft vs checked sync
  }, [fromVersion, toVersion, checkedRange]);

  if (!latest) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No stable versions available to compare.
      </p>
    );
  }

  const selectVersions = versions.includes(fromVersion)
    ? versions
    : fromVersion
      ? [fromVersion, ...versions]
      : versions;

  const toSelectVersions = (() => {
    const pool = versions.includes(toVersion)
      ? versions
      : toVersion
        ? [toVersion, ...versions]
        : versions;
    if (!fromVersion) return pool.filter((v) => v !== fromVersion);
    const fromClean = semver.valid(fromVersion);
    if (!fromClean) return pool.filter((v) => v !== fromVersion);
    return pool.filter((version) => {
      const clean = semver.valid(version);
      if (!clean) return false;
      return semver.gt(clean, fromClean);
    });
  })();

  const nodeParse = parseNodeRuntimeVersion(nodeDraft);
  const nodeInvalid = !nodeParse.ok;

  const canCheckUpgrade =
    Boolean(fromVersion && toVersion) &&
    fromVersion !== toVersion &&
    toSelectVersions.includes(toVersion) &&
    !nodeInvalid;

  const runUpgradeCheck = () => {
    if (!canCheckUpgrade) return;
    const parsed = parseNodeRuntimeVersion(nodeDraft);
    if (!parsed.ok) return;
    setNodeDraft(parsed.value);
    setNodeRuntime(parsed.value);
    agentAbortRef.current?.abort();
    agentAbortRef.current = null;
    resetAgentState();
    setAgentLoading(false);
    setCheckedRange({ from: fromVersion, to: toVersion });
  };

  const breakingNotes = details?.breaking?.notes ?? [];
  const peerChanges = details?.peers?.changes ?? [];
  const needsUpgrade =
    advice && advice.verdict !== "current" && advice.verdict !== "invalid";

  const targetCooldown = npmReleaseCooldownStatus({
    publishedAt: advice?.toPublishedAt,
    cooldownHours,
  });
  const targetCooldownNote =
    needsUpgrade &&
    targetCooldown.withinCooldown &&
    targetCooldown.hoursSincePublish !== null
      ? npmReleaseCooldownCaution({
          hoursSincePublish: targetCooldown.hoursSincePublish,
          cooldownHours,
        })
      : null;

  const nodeEngineCheck = checkNodeAgainstTargetEngines({
    nodeVersion: nodeRuntime,
    engines: details?.manifest?.engines,
  });

  const agentStatusMessage = agentLoading
    ? agentStage
      ? `Generating agent brief, ${agentStage}`
      : "Generating agent brief"
    : agentError
      ? agentError
      : agentBrief
        ? "Agent brief ready"
        : null;
  useLiveMessage(agentStatusMessage, {
    politeness: agentError ? "assertive" : "polite",
  });

  const factLine = (() => {
    if (!advice || !needsUpgrade) return null;
    const parts: string[] = [];
    if (advice.releasesBehind > 0) {
      parts.push(
        `${advice.releasesBehind} release${advice.releasesBehind === 1 ? "" : "s"} behind`,
      );
    }
    if (advice.majorsCrossed > 0) {
      parts.push(
        `${advice.majorsCrossed} major${advice.majorsCrossed === 1 ? "" : "s"}`,
      );
    }
    if (advice.daysBetween !== null) {
      parts.push(`${advice.daysBetween.toLocaleString()} days`);
    }
    const published = formatPublishDate(advice.fromPublishedAt);
    if (published) parts.push(`from ${published}`);

    const fromVuln = fromSecurityLoading
      ? "…"
      : formatVulnCount(fromSecurity);
    const toVuln = toSecurityLoading ? "…" : formatVulnCount(toSecurity);
    parts.push(`advisories ${fromVuln} → ${toVuln}`);

    return parts.join(" · ");
  })();

  const detailsSummaryLabel = (() => {
    if (detailsLoading) return "Loading details…";
    if (detailsError) return "Details unavailable";
    const bits: string[] = [];
    const releaseTotal = details?.releases?.total ?? 0;
    if (releaseTotal > 0) {
      bits.push(
        `${releaseTotal} release${releaseTotal === 1 ? "" : "s"}`,
      );
    }
    if (breakingNotes.length > 0) {
      bits.push(
        `${breakingNotes.length} breaking`,
      );
    } else if (releaseTotal === 0) {
      bits.push("No breaking notes");
    }
    const dependencyCount = details?.manifest?.dependencyCount ?? 0;
    if (dependencyCount > 0) {
      bits.push(
        `${dependencyCount} dependency change${dependencyCount === 1 ? "" : "s"}`,
      );
    }
    if ((details?.manifest?.engines.length ?? 0) > 0) {
      bits.push("runtime changed");
    }
    if (details?.peers?.available) {
      bits.push(
        peerChanges.length === 0
          ? "peers unchanged"
          : `${peerChanges.length} peer change${peerChanges.length === 1 ? "" : "s"}`,
      );
    }
    return bits.join(" · ");
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="w-full sm:w-44 shrink-0">
          <label
            htmlFor="upgradeFromVersion"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            Current version
          </label>
          <SelectField
            id="upgradeFromVersion"
            value={fromVersion}
            onChange={(e) => {
              const nextFrom = e.target.value;
              setFromVersion(nextFrom);
              if (!nextFrom) return;
              const fromClean = semver.valid(nextFrom);
              const toClean = semver.valid(toVersion);
              const nextHigher =
                fromClean &&
                versions.find((version) => {
                  const clean = semver.valid(version);
                  return Boolean(clean && semver.gt(clean, fromClean));
                });
              if (
                !toClean ||
                !fromClean ||
                !semver.gt(toClean, fromClean)
              ) {
                setToVersion(nextHigher || latest || "");
              }
            }}
            className="w-full"
          >
            <option value="">Select version</option>
            {selectVersions.map((v) => (
              <option key={v} value={v}>
                {v}
                {v === latest ? " (latest)" : ""}
              </option>
            ))}
          </SelectField>
        </div>
        <div
          className="hidden sm:block pb-2 text-gray-400 dark:text-gray-400"
          aria-hidden="true"
        >
          →
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <label
            htmlFor="upgradeToVersion"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            Upgrade to
          </label>
          <SelectField
            id="upgradeToVersion"
            value={toSelectVersions.includes(toVersion) ? toVersion : ""}
            onChange={(e) => setToVersion(e.target.value)}
            disabled={!fromVersion || toSelectVersions.length === 0}
            className="w-full"
          >
            <option value="">
              {!fromVersion
                ? "Select current first"
                : toSelectVersions.length === 0
                  ? "No newer versions"
                  : "Select version"}
            </option>
            {toSelectVersions.map((v) => (
              <option key={v} value={v}>
                {v}
                {v === latest ? " (latest)" : ""}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-full sm:w-36 shrink-0">
          <label
            htmlFor="upgradeNodeVersion"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            Node Version
          </label>
          <input
            id="upgradeNodeVersion"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={latestNodeLts ?? "22.14.0"}
            value={nodeDraft}
            aria-invalid={nodeInvalid || undefined}
            aria-describedby={nodeInvalid ? "upgradeNodeVersionError" : undefined}
            onChange={(e) => setNodeDraft(e.target.value)}
            onBlur={() => {
              const parsed = parseNodeRuntimeVersion(nodeDraft);
              if (!parsed.ok) return;
              setNodeDraft(parsed.value);
              setNodeRuntime(parsed.value);
            }}
            className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm text-ink outline-none dark:bg-gray-800 ${
              nodeInvalid
                ? "border-red-500 focus:border-red-600"
                : "border-rule focus:border-signal"
            }`}
          />
        </div>
        <div className="w-full sm:w-auto shrink-0">
          <span
            className="mb-1 block text-xs font-medium text-transparent"
            aria-hidden="true"
          >
            Check
          </span>
          <button
            type="button"
            onClick={runUpgradeCheck}
            disabled={!canCheckUpgrade}
            className="w-full rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper enabled:hover:bg-signal disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-[9.5rem]"
          >
            Check upgrade
          </button>
        </div>
      </div>

      {nodeInvalid && (
        <p
          id="upgradeNodeVersionError"
          className="text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {nodeParse.message}
        </p>
      )}

      {!checkedRange && !nodeInvalid && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose current and target versions, then check the upgrade.
        </p>
      )}

      {advice && (
        <div
          className={`rounded-xl border overflow-hidden ${verdictStyles(advice.verdict)}`}
        >
          <div className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              {bumpLabel(advice) && (
                <span className="inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-black/5 dark:bg-white/10">
                  {bumpLabel(advice)}
                </span>
              )}
              {needsUpgrade && (
                <span className="font-mono text-xs opacity-80">
                  {advice.fromClean ?? advice.from}
                  <span className="mx-1 opacity-50">→</span>
                  {advice.toClean ?? advice.to}
                </span>
              )}
            </div>
            <p className="mt-2 text-base font-semibold leading-snug">
              {advice.headline}
            </p>
            <p className="mt-1 text-sm leading-relaxed opacity-90">
              {advice.summary}
            </p>
            {factLine && (
              <p className="mt-3 text-xs leading-relaxed opacity-70">
                {factLine}
              </p>
            )}
            {targetCooldownNote && (
              <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-sm leading-relaxed text-amber-950 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-50">
                <span className="font-semibold">New release. </span>
                {targetCooldownNote}. Prefer waiting or pick an older target if
                this package is high-risk.
              </p>
            )}
            {needsUpgrade && nodeEngineCheck.message && (
              <p
                className={`mt-3 text-sm leading-relaxed ${
                  nodeEngineCheck.satisfies === false
                    ? "text-red-800 dark:text-red-200"
                    : "opacity-90"
                }`}
              >
                <span className="font-semibold">Node runtime. </span>
                {nodeEngineCheck.message}
              </p>
            )}
            {needsUpgrade && details?.manifest?.deprecation.from && (
              <p className="mt-3 text-sm leading-relaxed">
                <span className="font-semibold">Deprecated. </span>
                {details.manifest.deprecation.from}
              </p>
            )}
            {needsUpgrade && details?.manifest?.moduleType && (
              <p className="mt-3 text-sm leading-relaxed">
                <span className="font-semibold">Module format. </span>
                {moduleFormatLabel(details.manifest.moduleType.from)}
                <span className="mx-1 opacity-50">→</span>
                {moduleFormatLabel(details.manifest.moduleType.to)}
              </p>
            )}
            {needsUpgrade && (details?.manifest?.engines.length ?? 0) > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                  Runtime
                </p>
                <ul className="mt-1.5 space-y-1">
                  {details!.manifest!.engines.map((change) => (
                    <li
                      key={`${change.kind}:${change.name}`}
                      className="flex flex-wrap items-baseline gap-x-2 text-sm"
                    >
                      <span className="font-mono font-medium">{change.name}</span>
                      <span className="font-mono text-xs opacity-70">
                        {peerChangeRange(change)}
                      </span>
                      {peerChangeImpact(change) ? (
                        <span className="text-xs text-amber-800 dark:text-amber-200">
                          {peerChangeImpact(change)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {needsUpgrade && fromSecurity?.vulnerabilities && fromSecurity.vulnerabilities.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                  Advisories on {advice.fromClean ?? advice.from}
                </p>
                <ul className="mt-1 space-y-1.5">
                  {fromSecurity.vulnerabilities.slice(0, 6).map((advisory) => {
                    const still = advisoryStillAffects(
                      advice.toClean ?? advice.to,
                      advisory.vulnerableVersionRange,
                    );
                    const status =
                      still === true
                        ? `Still open on ${advice.toClean ?? advice.to}`
                        : still === false
                          ? `Cleared on ${advice.toClean ?? advice.to}`
                          : advisory.patchedVersions
                            ? `Patched in ${advisory.patchedVersions}`
                            : "Range not stated";
                    return (
                      <li key={advisory.id} className="text-sm leading-snug">
                        {advisory.url ? (
                          <a
                            href={advisory.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                          >
                            {advisory.title}
                          </a>
                        ) : (
                          advisory.title
                        )}
                        <span className="mt-0.5 block text-xs opacity-70">
                          {advisory.cveId ? `${advisory.cveId} · ` : ""}
                          {advisory.severity} · {status}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {fromSecurity.vulnerabilities.length > 6 && (
                  <p className="mt-1 text-xs opacity-70">
                    {fromSecurity.vulnerabilities.length - 6} more on this version.
                  </p>
                )}
              </div>
            )}
            {advice.intermediateMajors.length > 0 && (
              <p className="mt-2 font-mono text-xs opacity-80">
                Path: {advice.fromClean}
                {advice.intermediateMajors.map((v) => (
                  <span key={v}>
                    {" → "}
                    {v}
                  </span>
                ))}
                {" → "}
                {advice.toClean}
              </p>
            )}
          </div>

          {needsUpgrade && (
            <details
              ref={changeNotesRef}
              className="border-t border-black/10 dark:border-white/10 group"
            >
              <summary className="cursor-pointer list-none px-4 py-3 sm:px-5 text-sm font-medium flex items-center justify-between gap-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="text-xs opacity-50 transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  What changed
                </span>
                <span className="text-xs font-normal opacity-60 truncate">
                  {detailsSummaryLabel}
                </span>
              </summary>
              <div className="px-4 pb-4 sm:px-5 sm:pb-5 space-y-5 text-sm">
                {detailsError && (
                  <p className="text-red-700 dark:text-red-300">{detailsError}</p>
                )}

                {!detailsLoading && !detailsError && details && (
                  <>
                    <div>
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                          Breaking
                        </p>
                        <div className="flex gap-3 text-xs">
                          {details.github?.changelogUrl && (
                            <a
                              href={details.github.changelogUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 opacity-80 hover:opacity-100"
                            >
                              Changelog
                            </a>
                          )}
                          {details.github?.compareUrl && (
                            <a
                              href={details.github.compareUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 opacity-80 hover:opacity-100"
                            >
                              Compare
                            </a>
                          )}
                        </div>
                      </div>
                      {breakingNotes.length === 0 ? (
                        <p className="text-sm opacity-70 leading-relaxed">
                          {!details.github
                            ? "No GitHub repository linked."
                            : "No explicit breaking-change notes for this range."}
                        </p>
                      ) : (
                        <ul className="space-y-3">
                          {breakingNotes.map((release) => (
                            <li key={release.tag}>
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-mono font-semibold">
                                  {release.version}
                                </span>
                                {release.url ? (
                                  <a
                                    href={release.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs underline underline-offset-2 opacity-80"
                                  >
                                    {release.title}
                                  </a>
                                ) : (
                                  <span className="text-xs opacity-60">
                                    {release.title}
                                  </span>
                                )}
                                {release.inferredMajor && (
                                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
                                    Inferred
                                  </span>
                                )}
                              </div>
                              <ul className="mt-1.5 space-y-1 border-l-2 border-current/20 pl-3">
                                {release.items.map((item, idx) => (
                                  <li
                                    key={`${release.tag}-${idx}`}
                                    className="opacity-90"
                                  >
                                    {item.url ? (
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline underline-offset-2"
                                      >
                                        {item.text}
                                      </a>
                                    ) : (
                                      item.text
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {(details.manifest?.dependencyCount ?? 0) > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                          Dependencies
                          {details.manifest &&
                          details.manifest.dependencyCount >
                            details.manifest.dependencies.length
                            ? ` · ${details.manifest.dependencies.length} of ${details.manifest.dependencyCount}`
                            : ` · ${details.manifest?.dependencies.length ?? 0}`}
                        </p>
                        <PeerChangeTable
                          changes={details.manifest?.dependencies ?? []}
                          caption="Dependency changes for this upgrade"
                        />
                      </div>
                    )}

                    {details.peers?.available && peerChanges.length > 0 ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                          Peers · {peerChanges.length}
                        </p>
                        <PeerChangeTable
                          changes={peerChanges}
                          caption="Peer dependency changes for this upgrade"
                        />
                      </div>
                    ) : null}

                    {(details.releases?.shown.length ?? 0) > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                          Releases
                          {details.releases &&
                          details.releases.total >
                            details.releases.shown.length
                            ? ` · ${details.releases.shown.length} of ${details.releases.total}`
                            : ""}
                        </p>
                        <ul className="space-y-1">
                          {details.releases?.shown.map((release) => (
                            <li
                              key={release.version}
                              className="flex flex-wrap items-baseline gap-x-2 text-sm"
                            >
                              <span className="font-mono font-semibold">
                                {release.version}
                              </span>
                              {release.url ? (
                                <a
                                  href={release.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline underline-offset-2 opacity-80"
                                >
                                  {release.title}
                                </a>
                              ) : (
                                <span className="opacity-80">
                                  {release.title}
                                </span>
                              )}
                              {release.publishedAt && (
                                <span className="text-xs opacity-60">
                                  {formatPublishDate(release.publishedAt)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {needsUpgrade && (
        <div className="rounded-xl border border-rule bg-white dark:bg-gray-800/60 p-4 sm:p-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Agent brief
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Prioritised checklist from the notes above · LangGraph
                {agentModel ? ` · ${agentModel}` : ""}
                {agentCached ? " · cached" : ""}
                {agentLoading && agentStage ? ` · ${agentStage}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                agentAbortRef.current?.abort();
                const controller = new AbortController();
                agentAbortRef.current = controller;
                void runAgentBrief({
                  force: Boolean(agentBrief),
                  signal: controller.signal,
                });
              }}
              disabled={agentLoading}
              className="w-full shrink-0 whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-paper enabled:hover:bg-signal disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-[11.5rem]"
            >
              {agentLoading
                ? "Generating…"
                : agentBrief
                  ? "Regenerate"
                  : "Generate agent brief"}
            </button>
          </div>

          {agentError && (
            <p className="text-sm text-red-600 dark:text-red-400">{agentError}</p>
          )}

          {(agentLoading || agentTools.length > 0) && (
            <AgentGraphSteps
              toolCalls={agentTools}
              activeStage={agentLoading ? agentStage : null}
            />
          )}

          {agentBrief && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink">
                  {agentBrief.headline}
                </p>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium capitalize ${severityBadgeClass(agentBrief.risk)}`}
                >
                  {agentBrief.risk} risk
                </span>
              </div>
              {agentBrief.bullets.length > 0 && (
                <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-200">
                  {agentBrief.bullets.map((bullet) => (
                    <li key={bullet}>
                      <LinkifiedText text={bullet} />
                    </li>
                  ))}
                </ul>
              )}
              {(agentBrief.watchFor?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                    Watch for
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-200">
                    {agentBrief.watchFor!.map((item) => (
                      <li key={item}>
                        <LinkifiedText text={item} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {agentBrief.nextSteps.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                    Next steps
                  </p>
                  <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-200">
                    {agentBrief.nextSteps.map((step) => (
                      <li key={step}>
                        <LinkifiedText text={step} />
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                    Example uses{" "}
                    <span className="font-mono">npm i</span>. Same package works
                    with pnpm, yarn, or bun.
                  </p>
                </div>
              )}
            </div>
          )}

          {agentLoading && !agentBrief && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Generating upgrade brief…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
