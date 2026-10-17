import { ChatGroq } from "@langchain/groq";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { buildUpgradeAdvice, listStableVersions } from "@/lib/upgrade/upgrade-advisor";
import {
  loadUpgradeDetails,
  truncateUpgradeDetailsForAgent,
} from "@/lib/upgrade/upgrade-details";
import { checkPackageSecurity } from "@/lib/data-fetchers/security";
import { fetchNpmPackageData } from "@/lib/data-fetchers/npm-registry";
import { getGroqUpgradeAgentModel, groqModelLabel } from "@/lib/ai/groq-config";
import {
  formatInstallStep,
  type PackageManagerPreference,
} from "@/lib/prefs/package-manager-pref";
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

export { UPGRADE_AGENT_GENERIC_ERROR } from "@/lib/ai/upgrade-agent-messages";
export type { UpgradeAgentStreamEvent } from "@/lib/ai/upgrade-agent-events";

const briefSchema = z.object({
  headline: z.string().describe("One-line upgrade verdict"),
  bullets: z
    .array(z.string())
    .max(6)
    .describe("Key facts grounded in tool results (1-6 items)"),
  risk: z
    .enum(["low", "moderate", "high"])
    .describe("Overall upgrade risk"),
  nextSteps: z
    .array(z.string())
    .max(5)
    .describe(
      "Ordered upgrade checklist (2-5 items). Review breaking risks first, then install with the preferred package manager from the facts.",
    ),
});

export type UpgradeAgentBrief = z.infer<typeof briefSchema>;

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
  return (
    /json_validate_failed/i.test(message) ||
    /Failed to validate JSON/i.test(message) ||
    /failed_generation/i.test(message) ||
    /Generated JSON does not match/i.test(message)
  );
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
  brief: Partial<UpgradeAgentBrief> | null | undefined,
): UpgradeAgentBrief => {
  const headline = brief?.headline?.trim() || "Upgrade brief unavailable";
  const bullets =
    brief?.bullets?.map((b) => b.trim()).filter(Boolean).slice(0, 6) ?? [];
  const nextSteps =
    brief?.nextSteps?.map((s) => s.trim()).filter(Boolean).slice(0, 5) ?? [];
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
  packageManager: Annotation<PackageManagerPreference>,
  facts: Annotation<string>,
  toolCalls: Annotation<string[]>,
  brief: Annotation<UpgradeAgentBrief | null>,
});

type FactsPayload = {
  packageName?: string;
  from?: string;
  to?: string;
  packageManager?: PackageManagerPreference;
  advice?: Record<string, unknown>;
  details?: {
    github?: {
      changelogUrl?: string | null;
      compareUrl?: string | null;
      releasesUrl?: string | null;
    } | null;
    breaking?: {
      notes?: Array<{
        version?: string;
        title?: string;
        items?: Array<{ text?: string; url?: string }>;
      }>;
      hasNotes?: boolean;
    };
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

  const align = changes.slice(0, 8).map((change) => {
    if (change.kind === "changed") {
      return `${change.name} (${change.from} → ${change.to})`;
    }
    if (change.kind === "added") {
      return `${change.name} (new peer: ${change.range ?? "?"})`;
    }
    return `${change.name} (removed peer)`;
  });

  return {
    count: changes.length,
    align,
    summary: `Align ${changes.length} peer dependenc${changes.length === 1 ? "y" : "ies"} with this upgrade: ${align.slice(0, 4).join("; ")}${align.length > 4 ? "…" : ""}`,
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

function installGuidance(pref: PackageManagerPreference): string {
  if (pref === "auto") {
    return (
      "packageManager preference is auto - give install examples for npm, pnpm, and yarn " +
      "(e.g. `npm install pkg@ver`, `pnpm add pkg@ver`, `yarn add pkg@ver`); do not assume only npm."
    );
  }
  const examples: Record<Exclude<PackageManagerPreference, "auto">, string> = {
    npm: "`npm install pkg@version`",
    pnpm: "`pnpm add pkg@version`",
    yarn: "`yarn add pkg@version`",
    bun: "`bun add pkg@version`",
  };
  return `packageManager preference is ${pref} - use ${examples[pref]} for the install step (match this manager only).`;
}

/** Ensure next steps include a concrete install command after an initial review step. */
export function normalizeNextSteps(
  steps: string[],
  packageName: string,
  to: string,
  packageManager: PackageManagerPreference = "auto",
): string[] {
  const cleaned = steps
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  const installStep = formatInstallStep(packageManager, packageName, to);
  const installIdx = cleaned.findIndex((s) => INSTALL_CMD_RE.test(s));

  let ordered = cleaned;
  if (installIdx === -1) {
    ordered =
      cleaned.length === 0
        ? [installStep]
        : [cleaned[0], installStep, ...cleaned.slice(1)];
  } else {
    // Rewrite whatever manager the model used to match the user preference.
    ordered = cleaned.map((step, i) =>
      i === installIdx ? installStep : step,
    );
    if (installIdx === 0 && ordered.length > 1) {
      const [install, ...rest] = ordered;
      ordered = [rest[0], install, ...rest.slice(1)];
    }
  }

  return ordered.slice(0, 5);
}

function nextStepsGuidance(packageManager: PackageManagerPreference): string {
  return `nextSteps must be a clear, ordered developer checklist (3–5 items):
1. FIRST: review release notes / breaking-change notes and peer risks - use a real URL from facts.enrichment.migration.urls or details when available; otherwise say to check the package's changelog for this range. Do not invent URLs. Call out named breaking changes from the facts when present.
2. THEN: install/upgrade to the target version. ${installGuidance(packageManager)} Only install after reviewing what may break.
3. If facts.enrichment.peers is present, include aligning those peers (name the packages from enrichment.peers.align).
4. If facts.enrichment.securityDelta shows more advisories on the target, call that out before or with the install step.
5. Run the project's tests and typecheck (or build) to catch breakages.
Do NOT invent vague steps like "monitor application logs", "update the package lock and rebuild" as a separate step (the lockfile updates with install), or generic "confirm compatibility" without saying how.
Write in UK English. Do not use "you" or "your". Use enrichment summaries when present - they are deterministic facts.`;
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

  const [adviceJson, detailsJson, fromSecJson, toSecJson] = await Promise.all([
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
      };
    })(),
    (async () => {
      toolCalls.push("get_upgrade_details");
      const details = await loadUpgradeDetails(packageName, from, to);
      // Keep peer list short - Angular-style majors can list dozens of peers.
      const truncated = truncateUpgradeDetailsForAgent(details, 4, 2);
      if (
        truncated.peers &&
        typeof truncated.peers === "object" &&
        "changes" in truncated.peers &&
        Array.isArray((truncated.peers as { changes: unknown[] }).changes)
      ) {
        (truncated.peers as { changes: unknown[] }).changes = (
          truncated.peers as { changes: unknown[] }
        ).changes.slice(0, 12);
      }
      return truncated;
    })(),
    (async () => {
      toolCalls.push("get_version_security:from");
      const security = await checkPackageSecurity(packageName, from);
      return {
        version: from,
        totalCount: security.totalCount,
        critical: security.critical,
        high: security.high,
        moderate: security.moderate,
        low: security.low,
      };
    })(),
    (async () => {
      toolCalls.push("get_version_security:to");
      const security = await checkPackageSecurity(packageName, to);
      return {
        version: to,
        totalCount: security.totalCount,
        critical: security.critical,
        high: security.high,
        moderate: security.moderate,
        low: security.low,
      };
    })(),
  ]);

  const facts = JSON.stringify({
    packageName,
    from,
    to,
    packageManager: state.packageManager,
    advice: adviceJson,
    details: detailsJson,
    security: { from: fromSecJson, to: toSecJson },
  });

  return { facts, toolCalls };
}

async function synthesizeBrief(state: typeof AgentState.State) {
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
      content: `You are an npm upgrade advisor. Reply with a short structured brief using ONLY the JSON facts provided. Do not invent versions, advisory counts, or breaking changes. If notes are empty, say so. Keep bullets and nextSteps concise (short sentences). Prefer facts.enrichment summaries (peers, securityDelta, migration) when present.\n\n${nextStepsGuidance(state.packageManager)}`,
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

  let raw: Partial<UpgradeAgentBrief>;
  try {
    raw = await invokeStructured();
  } catch (error) {
    if (!isJsonValidateError(error)) throw error;
    // gpt-oss sometimes returns empty JSON under jsonSchema; jsonMode is more forgiving.
    try {
      raw = await invokeStructured("jsonMode");
    } catch (retryError) {
      if (!isJsonValidateError(retryError)) throw retryError;
      throw new Error(UPGRADE_AGENT_GENERIC_ERROR);
    }
  }

  const brief = ensureBriefDefaults(raw);

  return {
    brief: {
      ...brief,
      nextSteps: normalizeNextSteps(
        brief.nextSteps,
        state.packageName,
        state.to,
        state.packageManager,
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
export async function* streamUpgradeAgent(input: {
  packageName: string;
  from: string;
  to: string;
  packageManager?: PackageManagerPreference;
  force?: boolean;
}): AsyncGenerator<UpgradeAgentStreamEvent> {
  const { packageName, from, to, packageManager = "auto", force = false } =
    input;
  requireGroqKey();

  const key = upgradeAgentCacheKey(packageName, from, to, packageManager);

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
        packageManager,
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
          brief = ensureBriefDefaults(slice.brief);
          brief = {
            ...brief,
            nextSteps: normalizeNextSteps(
              brief.nextSteps,
              packageName,
              to,
              packageManager,
            ),
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
      packageManager,
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
  packageManager?: PackageManagerPreference;
  force?: boolean;
}): Promise<UpgradeAgentResult> {
  let brief: UpgradeAgentBrief | null = null;
  let model = "";
  let toolCalls: string[] = [];

  for await (const event of streamUpgradeAgent(input)) {
    if (event.type === "error") {
      throw new Error(event.message);
    }
    if (event.type === "brief") {
      brief = event.brief;
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
