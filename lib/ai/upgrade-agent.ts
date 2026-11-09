import { ChatGroq } from "@langchain/groq";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import {
  buildDeterministicBrief,
  finalizeUpgradeBrief,
  isQuietUpgrade,
  type UpgradeBriefSeedInput,
} from "@/lib/ai/upgrade-agent-brief";
import { buildUpgradeAdvice, listStableVersions } from "@/lib/upgrade/upgrade-advisor";
import {
  loadUpgradeDetails,
  truncateUpgradeDetailsForAgent,
} from "@/lib/upgrade/upgrade-details";
import { formatPeerChangeLine } from "@/lib/upgrade/peer-range-diff";
import { advisoryStillAffects } from "@/lib/upgrade/upgrade-manifest";
import {
  checkNodeAgainstTargetEngines,
} from "@/lib/packages/node-engine-check";
import {
  npmReleaseCooldownCaution,
  npmReleaseCooldownStatus,
} from "@/lib/packages/npm-release-cooldown";
import { checkPackageSecurity } from "@/lib/data-fetchers/security";
import { fetchNpmPackageData } from "@/lib/data-fetchers/npm-registry";
import { getGroqUpgradeAgentModel, groqModelLabel } from "@/lib/ai/groq-config";
import { formatNpmInstallStep } from "@/lib/prefs/package-manager-pref";
import { UPGRADE_AGENT_GENERIC_ERROR } from "@/lib/ai/upgrade-agent-messages";
import type { UpgradeAgentStreamEvent } from "@/lib/ai/upgrade-agent-events";
import {
  getCachedUpgradeBrief,
  getInflightUpgradeBrief,
  setCachedUpgradeBrief,
  setInflightUpgradeBrief,
  upgradeAgentCacheKey,
  type CachedUpgradeBrief,
} from "@/lib/upgrade/upgrade-agent-cache";
import type { ProjectUpgradeFacts } from "@/lib/upgrade/project-upgrade-fit";

export { UPGRADE_AGENT_GENERIC_ERROR } from "@/lib/ai/upgrade-agent-messages";
export type { UpgradeAgentStreamEvent } from "@/lib/ai/upgrade-agent-events";
export {
  computeUpgradeRisk,
  buildSeedBullets,
  buildSeedWatchFor,
  buildContextualNextSteps,
  mergeUpgradeNextSteps,
  isQuietUpgrade,
  finalizeUpgradeBrief,
  upgradeAgeSignals,
  dependencyChangeCount,
  peerChangeCount,
} from "@/lib/ai/upgrade-agent-brief";

const briefSchema = z.object({
  headline: z.string().describe("One-line upgrade action verdict for this range"),
  bullets: z
    .array(z.string())
    .max(6)
    .describe(
      "Package-specific facts (peers, named breakages, advisory titles) — not the bump label",
    ),
  risk: z
    .enum(["low", "moderate", "high"])
    .describe("Overall upgrade risk (will be overridden by deterministic scoring)"),
  // Models often emit null for "none"; .optional() alone rejects null.
  watchFor: z
    .array(z.string())
    .max(4)
    .nullish()
    .describe(
      "Named breaking changes or peer risks to verify; use [] or omit when none (never null)",
    ),
  nextSteps: z
    .array(z.string())
    .max(5)
    .describe(
      "Ordered upgrade checklist (2-5 items). Review breaking risks first, then install with npm i.",
    ),
});

/** Structured-output shape from the model (watchFor may be null). */
type LlmUpgradeBrief = z.infer<typeof briefSchema>;

export type UpgradeAgentBrief = Omit<LlmUpgradeBrief, "watchFor"> & {
  watchFor: string[];
};

/** Accepted before defaults — allows null watchFor from the LLM schema. */
type RawUpgradeBrief = Partial<Omit<UpgradeAgentBrief, "watchFor">> & {
  watchFor?: string[] | null;
};

export type UpgradeAgentResult = {
  brief: UpgradeAgentBrief;
  model: string;
  toolCalls: string[];
};

/** Keep prompts small - large Angular-style payloads make gpt-oss emit empty JSON. */
const MAX_FACTS_CHARS = 10_000;

const clampFacts = (facts: string): string => {
  if (facts.length <= MAX_FACTS_CHARS) return facts;
  return `${facts.slice(0, MAX_FACTS_CHARS)}\n…[facts truncated for model]`;
};

const isJsonValidateError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code =
    error && typeof error === "object" && "lc_error_code" in error
      ? String((error as { lc_error_code?: unknown }).lc_error_code ?? "")
      : "";
  return (
    /json_validate_failed/i.test(message) ||
    /Failed to validate JSON/i.test(message) ||
    /failed_generation/i.test(message) ||
    /Generated JSON does not match/i.test(message) ||
    /OUTPUT_PARSING_FAILURE/i.test(message) ||
    /OUTPUT_PARSING_FAILURE/i.test(code)
  );
};

/** Recover a brief when the structured parser rejects near-valid JSON (e.g. null fields). */
const tryRecoverBriefFromParseError = (
  error: unknown,
): LlmUpgradeBrief | null => {
  if (!error || typeof error !== "object") return null;
  const llmOutput = (error as { llmOutput?: unknown }).llmOutput;
  if (typeof llmOutput !== "string" || !llmOutput.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(llmOutput);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const coerced = {
      ...record,
      watchFor: Array.isArray(record.watchFor)
        ? record.watchFor
        : record.watchFor == null
          ? undefined
          : record.watchFor,
      bullets: Array.isArray(record.bullets) ? record.bullets : undefined,
      nextSteps: Array.isArray(record.nextSteps) ? record.nextSteps : undefined,
    };
    const result = briefSchema.safeParse(coerced);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

export const isUpgradeAgentProviderError = (error: unknown): boolean => {
  if (isJsonValidateError(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /invalid_request_error/i.test(message) ||
    /structured (output|brief)/i.test(message) ||
    /empty JSON/i.test(message) ||
    /did not return a structured brief/i.test(message) ||
    message === UPGRADE_AGENT_GENERIC_ERROR
  );
};

const ensureBriefDefaults = (
  brief: RawUpgradeBrief | null | undefined,
  facts?: UpgradeBriefSeedInput,
  context?: { packageName: string; from: string; to: string },
): UpgradeAgentBrief => {
  if (facts) {
    const finalized = finalizeUpgradeBrief(
      {
        ...brief,
        watchFor: Array.isArray(brief?.watchFor) ? brief.watchFor : undefined,
      },
      facts,
      context,
    );
    return {
      ...finalized,
      watchFor: finalized.watchFor ?? [],
    };
  }

  const headline = brief?.headline?.trim() || "Upgrade brief unavailable";
  const bullets =
    brief?.bullets?.map((b) => b.trim()).filter(Boolean).slice(0, 6) ?? [];
  const nextSteps =
    brief?.nextSteps?.map((s) => s.trim()).filter(Boolean).slice(0, 6) ?? [];
  const watchFor = Array.isArray(brief?.watchFor)
    ? brief.watchFor.map((w) => w.trim()).filter(Boolean).slice(0, 4)
    : [];
  const risk =
    brief?.risk === "low" || brief?.risk === "high" || brief?.risk === "moderate"
      ? brief.risk
      : "moderate";

  return {
    headline,
    bullets:
      bullets.length > 0
        ? bullets
        : ["Limited structured output from the model - rely on the breaking notes and peers above."],
    risk,
    watchFor,
    nextSteps:
      nextSteps.length > 0
        ? nextSteps
        : ["Review the breaking-change notes and peer dependency changes for this range."],
  };
};

const AgentState = Annotation.Root({
  packageName: Annotation<string>,
  from: Annotation<string>,
  to: Annotation<string>,
  runtimeNode: Annotation<string>,
  cooldownHours: Annotation<number>,
  project: Annotation<ProjectUpgradeFacts | null>,
  facts: Annotation<string>,
  toolCalls: Annotation<string[]>,
  brief: Annotation<UpgradeAgentBrief | null>,
});

type AdvisoryFact = {
  title: string;
  severity: string;
  stillAffectsTo: boolean | null;
  cveId?: string;
};

type FactsPayload = UpgradeBriefSeedInput & {
  packageName?: string;
  from?: string;
  to?: string;
  details?: UpgradeBriefSeedInput["details"] & {
    github?: {
      changelogUrl?: string | null;
      compareUrl?: string | null;
      releasesUrl?: string | null;
    } | null;
    peers?: {
      available?: boolean;
      changes?: Array<{
        kind: string;
        name: string;
        range?: string;
        from?: string;
        to?: string;
      }>;
    };
  };
  security?: {
    from?: SecurityCounts;
    to?: SecurityCounts;
    advisories?: AdvisoryFact[];
  };
  enrichment?: {
    peers?: PeersEnrichment | null;
    securityDelta?: SecurityDeltaEnrichment | null;
    migration?: MigrationEnrichment | null;
  };
};

type SecurityCounts = {
  version?: string;
  totalCount?: number;
  critical?: number;
  high?: number;
  moderate?: number;
  low?: number;
};

type PeersEnrichment = {
  count: number;
  align: string[];
  summary: string;
};

type SecurityDeltaEnrichment = {
  fromTotal: number;
  toTotal: number;
  delta: number;
  summary: string;
  severity: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
};

type MigrationEnrichment = {
  urls: string[];
  summary: string;
};

const parseFacts = (raw: string): FactsPayload => {
  try {
    return JSON.parse(raw || "{}") as FactsPayload;
  } catch {
    return {};
  }
};

const writeFacts = (facts: FactsPayload): string => JSON.stringify(facts);

const appendToolCall = (
  state: typeof AgentState.State,
  name: string,
): string[] => [...(state.toolCalls ?? []), name];

const MIGRATION_URL_RE =
  /migrat|upgrade.?guide|updating.?to|update.?guide|breaking.?changes?/i;

const extractMigrationUrls = (facts: FactsPayload): string[] => {
  const found = new Set<string>();
  const consider = (url?: string | null) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (MIGRATION_URL_RE.test(url) || /changelog|releases?/i.test(url)) {
      found.add(url);
    }
  };

  consider(facts.details?.github?.changelogUrl);
  // Prefer explicit migration-ish links from note items
  for (const note of facts.details?.breaking?.notes ?? []) {
    for (const item of note.items ?? []) {
      if (item.url && MIGRATION_URL_RE.test(`${item.text ?? ""} ${item.url}`)) {
        found.add(item.url);
      } else if (item.text) {
        const match = item.text.match(/https?:\/\/[^\s)>\]]+/gi);
        for (const url of match ?? []) {
          if (MIGRATION_URL_RE.test(url) || MIGRATION_URL_RE.test(item.text)) {
            found.add(url.replace(/[.,;:]+$/, ""));
          }
        }
      }
    }
  }

  return [...found].slice(0, 5);
};

const buildPeersEnrichment = (facts: FactsPayload): PeersEnrichment | null => {
  const changes = facts.details?.peers?.changes ?? [];
  if (changes.length === 0) return null;

  const align = changes
    .slice(0, 8)
    .map((change) => formatPeerChangeLine(change))
    .filter(Boolean);

  return {
    count: changes.length,
    align,
    summary: `Review ${changes.length} peer dependenc${changes.length === 1 ? "y" : "ies"} for this upgrade: ${align.slice(0, 4).join("; ")}${align.length > 4 ? "…" : ""}`,
  };
};

const severityDelta = (
  key: keyof Pick<SecurityCounts, "critical" | "high" | "moderate" | "low">,
  from?: SecurityCounts,
  to?: SecurityCounts,
): number => (to?.[key] ?? 0) - (from?.[key] ?? 0);

const buildSecurityDelta = (
  facts: FactsPayload,
): SecurityDeltaEnrichment | null => {
  const from = facts.security?.from;
  const to = facts.security?.to;
  if (!from || !to) return null;

  const fromTotal = from.totalCount ?? 0;
  const toTotal = to.totalCount ?? 0;
  const delta = toTotal - fromTotal;
  let summary: string;
  if (delta < 0) {
    summary = `Security improves: ${fromTotal} → ${toTotal} advisories (${Math.abs(delta)} fewer on the target).`;
  } else if (delta > 0) {
    summary = `Security worsens: ${fromTotal} → ${toTotal} advisories (${delta} more on the target).`;
  } else {
    summary = `Advisory count unchanged (${fromTotal} on both versions) - still review severity mix.`;
  }

  return {
    fromTotal,
    toTotal,
    delta,
    summary,
    severity: {
      critical: severityDelta("critical", from, to),
      high: severityDelta("high", from, to),
      moderate: severityDelta("moderate", from, to),
      low: severityDelta("low", from, to),
    },
  };
};

const buildMigrationEnrichment = (
  facts: FactsPayload,
): MigrationEnrichment | null => {
  const urls = extractMigrationUrls(facts);
  if (urls.length === 0) return null;
  return {
    urls,
    summary: `Official migration / changelog links found (${urls.length}). Review before installing.`,
  };
};

const needsPeers = (facts: FactsPayload): boolean =>
  Boolean(buildPeersEnrichment(facts));

/** Only divert when the advisory picture actually changes. */
const needsSecurityDelta = (facts: FactsPayload): boolean => {
  const delta = buildSecurityDelta(facts);
  if (!delta) return false;
  return (
    delta.delta !== 0 ||
    delta.severity.critical !== 0 ||
    delta.severity.high !== 0 ||
    delta.severity.moderate !== 0 ||
    delta.severity.low !== 0
  );
};

const needsMigration = (facts: FactsPayload): boolean =>
  Boolean(buildMigrationEnrichment(facts));

type EnrichRoute = "peers" | "securityDelta" | "migration" | "synthesize";

/**
 * Decision-tree router: pick the next enrichment that facts justify,
 * otherwise go straight to synthesize.
 */
const nextEnrichRoute = (
  facts: FactsPayload,
  completed: "collect" | "peers" | "securityDelta" | "migration",
): EnrichRoute => {
  const sequence: Array<{
    id: Exclude<EnrichRoute, "synthesize">;
    need: () => boolean;
  }> = [
    { id: "peers", need: () => needsPeers(facts) },
    { id: "securityDelta", need: () => needsSecurityDelta(facts) },
    { id: "migration", need: () => needsMigration(facts) },
  ];

  const startIndex =
    completed === "collect"
      ? 0
      : completed === "peers"
        ? 1
        : completed === "securityDelta"
          ? 2
          : 3;

  for (let i = startIndex; i < sequence.length; i++) {
    if (sequence[i].need()) return sequence[i].id;
  }
  return "synthesize";
};

const routeAfterCollect = (state: typeof AgentState.State): EnrichRoute =>
  nextEnrichRoute(parseFacts(state.facts), "collect");

const routeAfterPeers = (state: typeof AgentState.State): EnrichRoute =>
  nextEnrichRoute(parseFacts(state.facts), "peers");

const routeAfterSecurityDelta = (state: typeof AgentState.State): EnrichRoute =>
  nextEnrichRoute(parseFacts(state.facts), "securityDelta");

/** Peers node - only entered when peerDependency changes exist. */
async function enrichPeers(state: typeof AgentState.State) {
  const facts = parseFacts(state.facts);
  const peers = buildPeersEnrichment(facts);
  if (!peers) {
    return { toolCalls: appendToolCall(state, "enrich_peers:skip") };
  }
  const enrichment = { ...(facts.enrichment ?? {}), peers };
  return {
    facts: writeFacts({ ...facts, enrichment }),
    toolCalls: appendToolCall(state, `enrich_peers:${peers.count}`),
  };
}

/** Security delta - only entered when advisory counts/severity change. */
async function enrichSecurityDelta(state: typeof AgentState.State) {
  const facts = parseFacts(state.facts);
  const securityDelta = buildSecurityDelta(facts);
  if (!securityDelta || !needsSecurityDelta(facts)) {
    return { toolCalls: appendToolCall(state, "enrich_security_delta:skip") };
  }
  const enrichment = { ...(facts.enrichment ?? {}), securityDelta };
  return {
    facts: writeFacts({ ...facts, enrichment }),
    toolCalls: appendToolCall(
      state,
      `enrich_security_delta:${securityDelta.delta >= 0 ? "+" : ""}${securityDelta.delta}`,
    ),
  };
}

/** Migration node - only entered when guide/changelog URLs appear. */
async function enrichMigration(state: typeof AgentState.State) {
  const facts = parseFacts(state.facts);
  const migration = buildMigrationEnrichment(facts);
  if (!migration) {
    return { toolCalls: appendToolCall(state, "enrich_migration:skip") };
  }
  const enrichment = { ...(facts.enrichment ?? {}), migration };
  return {
    facts: writeFacts({ ...facts, enrichment }),
    toolCalls: appendToolCall(state, `enrich_migration:${migration.urls.length}`),
  };
}

const INSTALL_CMD_RE =
  /\b(?:npm\s+(?:install|i|update)|pnpm\s+(?:add|update|i)|yarn\s+(?:add|upgrade)|bun\s+add)\b/i;

/** Ensure next steps include a concrete `npm i` command after review / Node / peer prep. */
export function normalizeNextSteps(
  steps: string[],
  packageName: string,
  to: string,
): string[] {
  const cleaned = steps
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

  const installStep = formatNpmInstallStep(packageName, to);
  const installIdx = cleaned.findIndex((s) => INSTALL_CMD_RE.test(s));

  let ordered = cleaned;
  if (installIdx === -1) {
    // Keep blocking prep (Node / peers / review) ahead of install.
    const prepEnd = cleaned.findIndex((s) =>
      /Align peer dependencies|Upgrade Node first|Confirm the runtime meets Node|Review (release notes|the changelog)|release cooldown/i.test(
        s,
      ),
    );
    if (cleaned.length === 0) {
      ordered = [installStep];
    } else if (prepEnd === -1) {
      ordered = [cleaned[0], installStep, ...cleaned.slice(1)];
    } else {
      let insertAt = 0;
      for (let i = 0; i < cleaned.length; i++) {
        if (
          /Upgrade Node first|Confirm the runtime meets Node|Review (release notes|the changelog)|release cooldown|Align peer dependencies|Security (improves|worsens|Advisory)/i.test(
            cleaned[i],
          )
        ) {
          insertAt = i + 1;
        } else {
          break;
        }
      }
      ordered = [
        ...cleaned.slice(0, insertAt),
        installStep,
        ...cleaned.slice(insertAt),
      ];
    }
  } else {
    // Rewrite whatever install command the model used to `npm i`.
    ordered = cleaned.map((step, i) =>
      i === installIdx ? installStep : step,
    );
    if (installIdx === 0 && ordered.length > 1) {
      const [install, ...rest] = ordered;
      ordered = [rest[0], install, ...rest.slice(1)];
    }
  }

  return ordered.slice(0, 6);
}

function nextStepsGuidance(): string {
  return `nextSteps must be a clear, ordered developer checklist (3–6 items) for facts.packageName from→to:
1. If facts.runtime.nodeSatisfies is false: FIRST upgrade Node so the runtime meets facts.runtime.nodeEngine (cite runtime.node and the target package@version). Do this before install.
2. Review release notes / breaking-change notes for this exact from→to range — use a real URL from facts.enrichment.migration.urls or details.github when available; otherwise say to check the package changelog for this range. Do not invent URLs.
3. If the current version is old (advice.fromPublishedAt / advice.daysBetween ≥ ~1 year): call for extra regression coverage — stale baselines raise integration risk.
4. If facts.enrichment.peers (or details.peers.changes) is present: review and align those peers. When align/summary says a peer "drops" a clause (e.g. graphql drops ^15.2.0 / 15.x), call that out explicitly — do not only restate from → to.
4b. If facts.project.hasContext and facts.project.peerFits lists conflicts/missing: add steps to align those project peers (cite name + required range). If facts.project.reversePeerFits lists conflicts: other project packages peer-depend on this upgrade and reject the target — cite consumer name + peer range. If facts.project.enginesConflict: update package.json engines.node.
5. If details.manifestHighlights.dependencyCount is material: review those dependency changes (lockfile / transitive impact) before install.
6. If facts.runtime.targetWithinCooldown: wait out the cooldown or pick an older target before installing.
7. THEN install with \`npm i pkg@version\` using the real package name and target version. Do not suggest pnpm, yarn, or bun.
8. Run the project's tests and typecheck (or build).
If facts.enrichment.securityDelta shows more advisories on the target, mention that before install. Name engines / module-format changes when present in facts.
Do NOT invent vague steps like "monitor application logs", "update the package lock and rebuild" as a separate step, or generic "confirm compatibility" without saying how.
Write in UK English. Do not use "you" or "your". Use enrichment summaries and security.advisories titles when present — they are deterministic facts.`;
}

function synthesizeSystemPrompt(): string {
  return `You are an npm upgrade advisor writing a prioritised checklist for this from→to range.

Use ONLY the JSON facts. Do not invent versions, advisory counts, URLs, or breaking changes.
The selected range is facts.from → facts.to for facts.packageName, with runtime Node in facts.runtime — checklist steps must match that selection.
Do NOT restate advice.bump, advice.releasesBehind, advice.headline, or advice.summary — the UI already shows those.
Bullets must cite concrete names from the facts: peer packages, breaking note item text, security.advisories titles, engines, or module format.
watchFor: up to 4 named breakages or peer risks to verify (short phrases). Use an empty array when none — never null.
If details.breaking.hasNotes is false, say so once in bullets and lean on peers, security, and manifestHighlights instead.
Prefer facts.enrichment summaries and security.advisories when present.
If facts.runtime.nodeSatisfies is false or nodeMessage is set, include a concrete Node upgrade/compatibility step before install.
If advice.fromPublishedAt is old or advice.daysBetween is large, treat that as higher risk and say so in bullets/nextSteps.
If facts.enrichment.peers or details.manifestHighlights.dependencyCount is set, name peer/dependency review as part of the checklist for this range.
When a peer range drops an OR-clause (for example GraphQL 15), say which major/line is no longer accepted.

${nextStepsGuidance()}`;
}

function requireGroqKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  return key;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /\b429\b/.test(message) ||
    /rate.?limit/i.test(message) ||
    /tokens per minute/i.test(message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || i === attempts - 1) throw error;
      // Groq often says "try again in ~600ms"; wait a bit longer to clear TPM window.
      await sleep(1500 * (i + 1));
    }
  }
  throw lastError ?? new Error("Request failed");
}

async function collectFacts(state: typeof AgentState.State) {
  const { packageName, from, to } = state;
  const toolCalls: string[] = [];

  const [adviceJson, detailsRaw, fromSecurity, toSecurity] = await Promise.all([
    (async () => {
      toolCalls.push("get_upgrade_advice");
      const { data: npm } = await fetchNpmPackageData(packageName);
      const versions = listStableVersions(npm.time);
      const advice = buildUpgradeAdvice({
        from,
        to,
        versionTimes: npm.time,
        versions,
      });
      return {
        headline: advice.headline,
        summary: advice.summary,
        bump: advice.bump,
        verdict: advice.verdict,
        releasesBehind: advice.releasesBehind,
        majorsCrossed: advice.majorsCrossed,
        daysBetween: advice.daysBetween,
        intermediateMajors: advice.intermediateMajors,
        fromClean: advice.fromClean,
        toClean: advice.toClean,
        fromPublishedAt: advice.fromPublishedAt,
        toPublishedAt: advice.toPublishedAt,
      };
    })(),
    (async () => {
      toolCalls.push("get_upgrade_details");
      return loadUpgradeDetails(packageName, from, to);
    })(),
    (async () => {
      toolCalls.push("get_version_security:from");
      return checkPackageSecurity(packageName, from);
    })(),
    (async () => {
      toolCalls.push("get_version_security:to");
      return checkPackageSecurity(packageName, to);
    })(),
  ]);

  const majorRange =
    adviceJson.bump === "major" || (adviceJson.majorsCrossed ?? 0) >= 1;
  const maxNotes = majorRange ? 8 : 6;
  const maxItems = majorRange ? 4 : 3;
  const detailsJson = truncateUpgradeDetailsForAgent(
    detailsRaw,
    maxNotes,
    maxItems,
  );
  if (
    detailsJson.peers &&
    typeof detailsJson.peers === "object" &&
    "changes" in detailsJson.peers &&
    Array.isArray((detailsJson.peers as { changes: unknown[] }).changes)
  ) {
    (detailsJson.peers as { changes: unknown[] }).changes = (
      detailsJson.peers as { changes: unknown[] }
    ).changes.slice(0, 12);
  }

  const fromSecJson = {
    version: from,
    totalCount: fromSecurity.totalCount,
    critical: fromSecurity.critical,
    high: fromSecurity.high,
    moderate: fromSecurity.moderate,
    low: fromSecurity.low,
  };
  const toSecJson = {
    version: to,
    totalCount: toSecurity.totalCount,
    critical: toSecurity.critical,
    high: toSecurity.high,
    moderate: toSecurity.moderate,
    low: toSecurity.low,
  };

  const advisories: AdvisoryFact[] = fromSecurity.vulnerabilities
    .slice(0, 6)
    .map((vuln) => ({
      title: vuln.title,
      severity: vuln.severity,
      cveId: vuln.cveId,
      stillAffectsTo: advisoryStillAffects(to, vuln.vulnerableVersionRange),
    }));

  const engines =
    (
      detailsJson.manifest as
        | {
            engines?: Array<{
              name: string;
              kind: string;
              range?: string;
              from?: string;
              to?: string;
            }>;
          }
        | null
        | undefined
    )?.engines ?? [];
  const nodeCheck = checkNodeAgainstTargetEngines({
    nodeVersion: state.runtimeNode,
    engines,
  });
  const cooldown = npmReleaseCooldownStatus({
    publishedAt: adviceJson.toPublishedAt,
    cooldownHours: state.cooldownHours,
  });
  const cooldownMessage =
    cooldown.withinCooldown && cooldown.hoursSincePublish !== null
      ? npmReleaseCooldownCaution({
          hoursSincePublish: cooldown.hoursSincePublish,
          cooldownHours: state.cooldownHours,
        })
      : null;

  const facts = JSON.stringify({
    packageName,
    from,
    to,
    advice: adviceJson,
    details: detailsJson,
    security: { from: fromSecJson, to: toSecJson, advisories },
    runtime: {
      node: state.runtimeNode || null,
      nodeEngine: nodeCheck.required,
      nodeSatisfies: nodeCheck.satisfies,
      nodeMessage: nodeCheck.message,
      targetWithinCooldown: cooldown.withinCooldown,
      cooldownHours: state.cooldownHours,
      hoursSincePublish: cooldown.hoursSincePublish,
      cooldownMessage,
    },
    project: state.project?.hasContext
      ? {
          hasContext: true,
          fingerprint: state.project.fingerprint || undefined,
          packageRequested: state.project.packageRequested,
          peerFits: state.project.peerFits.slice(0, 12),
          reversePeerFits: state.project.reversePeerFits.slice(0, 12),
          enginesNode: state.project.enginesNode,
          enginesConflict: state.project.enginesConflict,
          conflictCount: state.project.conflictCount,
          missingCount: state.project.missingCount,
        }
      : { hasContext: false },
  });

  return { facts, toolCalls };
}

async function synthesizeBrief(state: typeof AgentState.State) {
  const facts = parseFacts(state.facts);

  // Quiet patch/minor with no signals — deterministic brief, skip Groq.
  if (isQuietUpgrade(facts)) {
    const deterministic = buildDeterministicBrief(
      facts,
      state.packageName,
      state.from,
      state.to,
    );
    return {
      brief: {
        ...deterministic,
        nextSteps: normalizeNextSteps(
          deterministic.nextSteps,
          state.packageName,
          state.to,
        ),
      },
      toolCalls: appendToolCall(state, "synthesize:deterministic"),
    };
  }

  requireGroqKey();

  const model = getGroqUpgradeAgentModel();
  // gpt-oss spends tokens on reasoning; a low budget often yields empty failed_generation.
  const llm = new ChatGroq({
    model,
    temperature: 0.1,
    maxTokens: 4096,
    reasoningEffort: "low",
    apiKey: process.env.GROQ_API_KEY,
  });

  const messages = [
    {
      role: "system" as const,
      content: synthesizeSystemPrompt(),
    },
    {
      role: "user" as const,
      content: `Upgrade brief for ${state.packageName}: ${state.from} → ${state.to}.\n\nFacts:\n${clampFacts(state.facts)}`,
    },
  ];

  const invokeStructured = async (method?: "jsonSchema" | "jsonMode") => {
    const structured = llm.withStructuredOutput(briefSchema, {
      name: "upgrade_brief",
      ...(method ? { method } : {}),
    });
    return withRateLimitRetry(() => structured.invoke(messages));
  };

  let raw: RawUpgradeBrief;
  try {
    raw = await invokeStructured();
  } catch (error) {
    const recovered = tryRecoverBriefFromParseError(error);
    if (recovered) {
      raw = recovered;
    } else if (!isJsonValidateError(error)) {
      throw error;
    } else {
      // gpt-oss sometimes returns empty JSON under jsonSchema; jsonMode is more forgiving.
      try {
        raw = await invokeStructured("jsonMode");
      } catch (retryError) {
        const retryRecovered = tryRecoverBriefFromParseError(retryError);
        if (retryRecovered) {
          raw = retryRecovered;
        } else if (!isJsonValidateError(retryError)) {
          throw retryError;
        } else {
          throw new Error(UPGRADE_AGENT_GENERIC_ERROR);
        }
      }
    }
  }

  const brief = ensureBriefDefaults(raw, facts, {
    packageName: state.packageName,
    from: state.from,
    to: state.to,
  });

  return {
    brief: {
      ...brief,
      nextSteps: normalizeNextSteps(
        brief.nextSteps,
        state.packageName,
        state.to,
      ),
    },
    toolCalls: appendToolCall(state, "synthesize"),
  };
}

function buildUpgradeAgentGraph() {
  const enrichTargets: EnrichRoute[] = [
    "peers",
    "securityDelta",
    "migration",
    "synthesize",
  ];

  return new StateGraph(AgentState)
    .addNode("collect", collectFacts)
    .addNode("peers", enrichPeers)
    .addNode("securityDelta", enrichSecurityDelta)
    .addNode("migration", enrichMigration)
    .addNode("synthesize", synthesizeBrief)
    .addEdge(START, "collect")
    .addConditionalEdges("collect", routeAfterCollect, enrichTargets)
    .addConditionalEdges("peers", routeAfterPeers, enrichTargets)
    .addConditionalEdges("securityDelta", routeAfterSecurityDelta, enrichTargets)
    .addEdge("migration", "synthesize")
    .addEdge("synthesize", END)
    .compile();
}

/**
 * LangGraph upgrade agent with a decision-tree style route:
 * collect → (peers? → securityDelta? → migration?) → synthesize.
 * Yields progress events for SSE; caches successful briefs.
 */
/** Sanitize client-supplied project facts for the agent brief. */
export function sanitizeProjectUpgradeFacts(
  value: unknown,
): ProjectUpgradeFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.hasContext !== true) {
    return {
      hasContext: false,
      fingerprint: "",
      packageRequested: null,
      peerFits: [],
      reversePeerFits: [],
      enginesNode: null,
      enginesConflict: false,
      conflictCount: 0,
      missingCount: 0,
    };
  }
  const peerFitsRaw = Array.isArray(raw.peerFits) ? raw.peerFits : [];
  const peerFits: ProjectUpgradeFacts["peerFits"] = [];
  for (const row of peerFitsRaw.slice(0, 12)) {
    if (!row || typeof row !== "object") continue;
    const peer = row as Record<string, unknown>;
    const name = typeof peer.name === "string" ? peer.name.trim() : "";
    const required =
      typeof peer.required === "string" ? peer.required.trim() : "";
    if (!name || !required) continue;
    const status =
      peer.status === "conflicts" ||
      peer.status === "missing" ||
      peer.status === "satisfies"
        ? peer.status
        : "missing";
    peerFits.push({
      name,
      required,
      project: typeof peer.project === "string" ? peer.project : null,
      status,
    });
  }

  const reverseRaw = Array.isArray(raw.reversePeerFits)
    ? raw.reversePeerFits
    : [];
  const reversePeerFits: ProjectUpgradeFacts["reversePeerFits"] = [];
  for (const row of reverseRaw.slice(0, 12)) {
    if (!row || typeof row !== "object") continue;
    const peer = row as Record<string, unknown>;
    const name = typeof peer.name === "string" ? peer.name.trim() : "";
    const required =
      typeof peer.required === "string" ? peer.required.trim() : "";
    const target =
      typeof peer.target === "string" ? peer.target.trim() : "";
    const at = typeof peer.at === "string" ? peer.at.trim() : "";
    if (!name || !required || !target) continue;
    reversePeerFits.push({
      name,
      at: at || target,
      required,
      target,
      status: peer.status === "satisfies" ? "satisfies" : "conflicts",
    });
  }

  return {
    hasContext: true,
    fingerprint:
      typeof raw.fingerprint === "string" ? raw.fingerprint.slice(0, 160) : "",
    packageRequested:
      typeof raw.packageRequested === "string" ? raw.packageRequested : null,
    peerFits,
    reversePeerFits,
    enginesNode: typeof raw.enginesNode === "string" ? raw.enginesNode : null,
    enginesConflict: raw.enginesConflict === true,
    conflictCount: Math.max(0, Math.floor(Number(raw.conflictCount) || 0)),
    missingCount: Math.max(0, Math.floor(Number(raw.missingCount) || 0)),
  };
}

export async function* streamUpgradeAgent(input: {
  packageName: string;
  from: string;
  to: string;
  force?: boolean;
  runtimeNode?: string | null;
  cooldownHours?: number;
  project?: ProjectUpgradeFacts | null;
}): AsyncGenerator<UpgradeAgentStreamEvent> {
  const {
    packageName,
    from,
    to,
    force = false,
    runtimeNode = "",
    cooldownHours = 0,
    project = null,
  } = input;
  requireGroqKey();

  const projectFingerprint = project?.hasContext
    ? project.fingerprint || "ctx"
    : "";
  const key = upgradeAgentCacheKey(
    packageName,
    from,
    to,
    runtimeNode,
    projectFingerprint,
  );

  if (!force) {
    const cached = getCachedUpgradeBrief(key);
    if (cached) {
      yield { type: "status", stage: "cache" };
      yield { type: "tools", toolCalls: cached.toolCalls };
      yield { type: "brief", brief: cached.brief };
      yield {
        type: "done",
        model: cached.model,
        toolCalls: cached.toolCalls,
        cached: true,
      };
      return;
    }

    const pending = getInflightUpgradeBrief(key);
    if (pending) {
      yield { type: "status", stage: "collect" };
      try {
        const shared = await pending;
        yield { type: "tools", toolCalls: shared.toolCalls };
        yield { type: "brief", brief: shared.brief };
        yield {
          type: "done",
          model: shared.model,
          toolCalls: shared.toolCalls,
          cached: true,
        };
      } catch {
        yield { type: "error", message: UPGRADE_AGENT_GENERIC_ERROR };
      }
      return;
    }
  }

  let resolveInflight!: (value: CachedUpgradeBrief) => void;
  let rejectInflight!: (reason?: unknown) => void;
  const inflightPromise = new Promise<CachedUpgradeBrief>((resolve, reject) => {
    resolveInflight = resolve;
    rejectInflight = reject;
  });
  setInflightUpgradeBrief(key, inflightPromise);

  try {
    yield { type: "status", stage: "collect" };

    const graph = buildUpgradeAgentGraph();
    const stream = await graph.stream(
      {
        packageName,
        from,
        to,
        runtimeNode: (runtimeNode ?? "").trim(),
        cooldownHours: Math.max(0, Math.floor(Number(cooldownHours) || 0)),
        project: project?.hasContext ? project : null,
        facts: "",
        toolCalls: [],
        brief: null,
      },
      { streamMode: "updates" },
    );

    let toolCalls: string[] = [];
    let brief: UpgradeAgentBrief | null = null;

    for await (const update of stream) {
      const entries = Object.entries(update ?? {});
      for (const [stage, partial] of entries) {
        yield { type: "status", stage };
        const slice = partial as {
          toolCalls?: string[];
          brief?: UpgradeAgentBrief | null;
        };
        if (Array.isArray(slice.toolCalls) && slice.toolCalls.length > 0) {
          toolCalls = slice.toolCalls;
          yield { type: "tools", toolCalls };
        }
        if (slice.brief?.headline) {
          // Synthesize already merged Node/peer/version steps for this range.
          brief = ensureBriefDefaults(slice.brief, undefined, {
            packageName,
            from,
            to,
          });
          brief = {
            ...brief,
            nextSteps: normalizeNextSteps(brief.nextSteps, packageName, to),
          };
          yield { type: "brief", brief };
        }
      }
    }

    if (!brief?.headline) {
      throw new Error(UPGRADE_AGENT_GENERIC_ERROR);
    }

    const model = groqModelLabel(getGroqUpgradeAgentModel());
    const stored = setCachedUpgradeBrief(key, {
      packageName,
      from,
      to,
      brief,
      model,
      toolCalls,
    });
    resolveInflight(stored);

    yield {
      type: "done",
      model,
      toolCalls,
      cached: false,
    };
  } catch (error: unknown) {
    rejectInflight(error);
    yield {
      type: "error",
      message: UPGRADE_AGENT_GENERIC_ERROR,
    };
  }
}

export async function runUpgradeAgent(input: {
  packageName: string;
  from: string;
  to: string;
  force?: boolean;
  runtimeNode?: string | null;
  cooldownHours?: number;
  project?: ProjectUpgradeFacts | null;
}): Promise<UpgradeAgentResult> {
  let brief: UpgradeAgentBrief | null = null;
  let model = "";
  let toolCalls: string[] = [];

  for await (const event of streamUpgradeAgent(input)) {
    if (event.type === "error") {
      throw new Error(event.message);
    }
    if (event.type === "brief") {
      brief = ensureBriefDefaults(event.brief, undefined, {
        packageName: input.packageName,
        from: input.from,
        to: input.to,
      });
    }
    if (event.type === "done") {
      model = event.model;
      toolCalls = event.toolCalls;
    }
  }

  if (!brief?.headline) {
    throw new Error(UPGRADE_AGENT_GENERIC_ERROR);
  }

  return { brief, model, toolCalls };
}
