/**
 * Deterministic risk, seed bullets, and brief finalisation for the npm
 * upgrade agent — keeps Groq from inventing risk or restating empty facts.
 */

import { formatPeerChangeLine } from "@/lib/upgrade/peer-range-diff";

export type UpgradeBriefRisk = "low" | "moderate" | "high";

export type UpgradeBriefSeedInput = {
  advice?: {
    bump?: string;
    majorsCrossed?: number;
    headline?: string;
    summary?: string;
    daysBetween?: number | null;
    fromPublishedAt?: string | null;
    toPublishedAt?: string | null;
  };
  details?: {
    breaking?: {
      hasNotes?: boolean;
      notes?: Array<{
        version?: string;
        title?: string;
        inferredMajor?: boolean;
        items?: Array<{ text?: string; url?: string }>;
      }>;
    };
    peers?: {
      changes?: Array<{
        kind?: string;
        name?: string;
        range?: string;
        from?: string;
        to?: string;
      }>;
    };
    manifestHighlights?: {
      deprecation?: { from?: string | null; to?: string | null };
      moduleType?: { from?: string; to?: string };
      engines?: Array<{ name?: string; kind?: string; from?: string; to?: string }>;
      dependencyCount?: number;
    } | null;
    github?: {
      changelogUrl?: string | null;
      compareUrl?: string | null;
    } | null;
  };
  security?: {
    from?: {
      totalCount?: number;
      critical?: number;
      high?: number;
    };
    to?: {
      totalCount?: number;
      critical?: number;
      high?: number;
    };
    advisories?: Array<{
      title?: string;
      severity?: string;
      stillAffectsTo?: boolean | null;
    }>;
  };
  enrichment?: {
    peers?: { count?: number; summary?: string; align?: string[] } | null;
    securityDelta?: {
      delta?: number;
      summary?: string;
      severity?: { critical?: number; high?: number };
    } | null;
    migration?: { urls?: string[]; summary?: string } | null;
  };
  runtime?: {
    node?: string | null;
    nodeEngine?: string | null;
    nodeSatisfies?: boolean | null;
    nodeMessage?: string | null;
    targetWithinCooldown?: boolean;
    cooldownHours?: number;
    hoursSincePublish?: number | null;
    cooldownMessage?: string | null;
  };
};

export type UpgradeAgentBriefShape = {
  headline: string;
  bullets: string[];
  risk: UpgradeBriefRisk;
  nextSteps: string[];
  watchFor: string[];
};

const hasPeerChanges = (facts: UpgradeBriefSeedInput): boolean =>
  (facts.details?.peers?.changes?.length ?? 0) > 0 ||
  (facts.enrichment?.peers?.count ?? 0) > 0;

const hasManifestSignals = (facts: UpgradeBriefSeedInput): boolean => {
  const h = facts.details?.manifestHighlights;
  if (!h) return false;
  return Boolean(
    h.deprecation?.from ||
      h.deprecation?.to ||
      h.moduleType ||
      (h.engines && h.engines.length > 0) ||
      (h.dependencyCount && h.dependencyCount > 0),
  );
};

const hasSecuritySignal = (facts: UpgradeBriefSeedInput): boolean => {
  const delta = facts.enrichment?.securityDelta?.delta ?? 0;
  if (delta !== 0) return true;
  const fromTotal = facts.security?.from?.totalCount ?? 0;
  const toTotal = facts.security?.to?.totalCount ?? 0;
  return fromTotal > 0 || toTotal > 0;
};

const MS_PER_DAY = 86_400_000;

/** Days since an ISO publish timestamp, or null when unknown. */
export function daysSincePublished(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!iso) return null;
  const published = Date.parse(iso);
  if (Number.isNaN(published)) return null;
  return Math.max(0, Math.floor((nowMs - published) / MS_PER_DAY));
}

export function peerChangeCount(facts: UpgradeBriefSeedInput): number {
  return (
    facts.enrichment?.peers?.count ??
    facts.details?.peers?.changes?.length ??
    0
  );
}

export function dependencyChangeCount(facts: UpgradeBriefSeedInput): number {
  return facts.details?.manifestHighlights?.dependencyCount ?? 0;
}

/** Stale current version and/or a long from→to publish gap. */
export function upgradeAgeSignals(
  facts: UpgradeBriefSeedInput,
  nowMs: number = Date.now(),
): {
  fromAgeDays: number | null;
  daysBetween: number | null;
  staleFrom: boolean;
  wideGap: boolean;
  veryStale: boolean;
} {
  const fromAgeDays = daysSincePublished(
    facts.advice?.fromPublishedAt,
    nowMs,
  );
  const daysBetween =
    typeof facts.advice?.daysBetween === "number" &&
    Number.isFinite(facts.advice.daysBetween)
      ? Math.max(0, Math.floor(facts.advice.daysBetween))
      : null;

  const staleFrom = fromAgeDays !== null && fromAgeDays >= 365;
  const wideGap = daysBetween !== null && daysBetween >= 365;
  const veryStale =
    (fromAgeDays !== null && fromAgeDays >= 730) ||
    (daysBetween !== null && daysBetween >= 730);

  return { fromAgeDays, daysBetween, staleFrom, wideGap, veryStale };
}

function formatAgeDays(days: number): string {
  if (days >= 365) {
    const years = days / 365;
    const rounded = years >= 10 ? Math.round(years) : Math.round(years * 10) / 10;
    return `${rounded} year${rounded === 1 ? "" : "s"}`;
  }
  if (days >= 45) {
    const months = Math.round(days / 30.44);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Quiet patch/minor with nothing actionable — skip Groq. */
export function isQuietUpgrade(facts: UpgradeBriefSeedInput): boolean {
  const bump = facts.advice?.bump ?? "unknown";
  if (bump === "major" || bump === "unknown" || bump === "same") return false;
  if ((facts.advice?.majorsCrossed ?? 0) >= 1) return false;
  if (facts.details?.breaking?.hasNotes) return false;
  if (hasPeerChanges(facts)) return false;
  if (hasManifestSignals(facts)) return false;
  if (hasSecuritySignal(facts)) return false;
  const age = upgradeAgeSignals(facts);
  if (age.staleFrom || age.wideGap) return false;
  if (dependencyChangeCount(facts) >= 5 || peerChangeCount(facts) >= 2) {
    return false;
  }
  return bump === "patch" || bump === "minor";
}

export function computeUpgradeRisk(
  facts: UpgradeBriefSeedInput,
): UpgradeBriefRisk {
  const bump = facts.advice?.bump ?? "unknown";
  const majorsCrossed = facts.advice?.majorsCrossed ?? 0;
  const hasNotes = Boolean(facts.details?.breaking?.hasNotes);
  const peerCount = peerChangeCount(facts);
  const depCount = dependencyChangeCount(facts);
  const age = upgradeAgeSignals(facts);
  const toCritical = facts.security?.to?.critical ?? 0;
  const toHigh = facts.security?.to?.high ?? 0;
  const stillSevere = (facts.security?.advisories ?? []).some(
    (a) =>
      a.stillAffectsTo === true &&
      (a.severity === "critical" || a.severity === "high"),
  );
  const secDelta = facts.enrichment?.securityDelta?.delta ?? 0;
  const secCriticalDelta =
    facts.enrichment?.securityDelta?.severity?.critical ?? 0;
  const secHighDelta = facts.enrichment?.securityDelta?.severity?.high ?? 0;

  const heavyGraph = peerCount >= 5 || depCount >= 15;
  const busyGraph = peerCount >= 3 || depCount >= 8;

  if (
    toCritical > 0 ||
    stillSevere ||
    secCriticalDelta > 0 ||
    (bump === "major" && hasNotes) ||
    majorsCrossed >= 2 ||
    (age.veryStale && (bump === "major" || majorsCrossed >= 1 || heavyGraph)) ||
    (age.veryStale && peerCount >= 3) ||
    (heavyGraph && (bump === "major" || age.staleFrom || age.wideGap))
  ) {
    return "high";
  }

  if (
    bump === "major" ||
    majorsCrossed >= 1 ||
    hasNotes ||
    peerCount >= 3 ||
    busyGraph ||
    age.staleFrom ||
    age.wideGap ||
    toHigh > 0 ||
    secHighDelta > 0 ||
    secDelta > 0 ||
    hasManifestSignals(facts)
  ) {
    return "moderate";
  }

  return "low";
}

function breakingItemTexts(facts: UpgradeBriefSeedInput): string[] {
  const out: string[] = [];
  for (const note of facts.details?.breaking?.notes ?? []) {
    if (note.inferredMajor) continue;
    for (const item of note.items ?? []) {
      const text = item.text?.trim();
      if (!text) continue;
      const label = note.version ? `${note.version}: ${text}` : text;
      out.push(label.length > 160 ? `${label.slice(0, 157)}…` : label);
      if (out.length >= 4) return out;
    }
  }
  return out;
}

export function buildSeedWatchFor(facts: UpgradeBriefSeedInput): string[] {
  const watch: string[] = [];
  const pushWatch = (line: string) => {
    const text = line.trim();
    if (!text) return;
    if (watch.some((w) => w.toLowerCase() === text.toLowerCase())) return;
    watch.push(text);
  };

  const age = upgradeAgeSignals(facts);
  if (age.veryStale || age.staleFrom || age.wideGap) {
    pushWatch("Stale baseline / wide publish gap — expect more integration risk");
  }

  for (const text of breakingItemTexts(facts)) {
    pushWatch(text);
    if (watch.length >= 4) return watch;
  }
  const peers = facts.enrichment?.peers?.align ?? [];
  for (const peer of peers) {
    if (watch.length >= 4) break;
    if (peer.trim()) pushWatch(`Peer: ${peer.trim()}`);
  }
  const depCount = dependencyChangeCount(facts);
  if (depCount >= 5 && watch.length < 4) {
    pushWatch(`Review ${depCount} dependency changes across this range`);
  }
  const engines = facts.details?.manifestHighlights?.engines ?? [];
  for (const engine of engines) {
    if (watch.length >= 4) break;
    if (!engine.name) continue;
    const range =
      engine.kind === "changed"
        ? `${engine.from ?? "?"} → ${engine.to ?? "?"}`
        : engine.to ?? engine.from ?? engine.kind ?? "";
    pushWatch(`Engine ${engine.name}: ${range}`);
  }
  return watch.slice(0, 4);
}

export function buildSeedBullets(facts: UpgradeBriefSeedInput): string[] {
  const bullets: string[] = [];
  const push = (line: string | undefined | null) => {
    const text = line?.trim();
    if (!text) return;
    if (bullets.some((b) => b.toLowerCase() === text.toLowerCase())) return;
    bullets.push(text);
  };

  const sec = facts.enrichment?.securityDelta?.summary;
  push(sec);

  const advisories = facts.security?.advisories ?? [];
  const cleared = advisories.filter((a) => a.stillAffectsTo === false);
  const stillOpen = advisories.filter((a) => a.stillAffectsTo === true);
  if (cleared.length > 0) {
    const titles = cleared
      .slice(0, 2)
      .map((a) => a.title)
      .filter(Boolean);
    push(
      titles.length > 0
        ? `Cleared on target: ${titles.join("; ")}${cleared.length > titles.length ? "…" : ""}`
        : `${cleared.length} advisor${cleared.length === 1 ? "y" : "ies"} cleared on the target.`,
    );
  }
  if (stillOpen.length > 0) {
    const titles = stillOpen
      .slice(0, 2)
      .map((a) => a.title)
      .filter(Boolean);
    push(
      titles.length > 0
        ? `Still open on target: ${titles.join("; ")}${stillOpen.length > titles.length ? "…" : ""}`
        : `${stillOpen.length} advisor${stillOpen.length === 1 ? "y" : "ies"} still open on the target.`,
    );
  }

  const age = upgradeAgeSignals(facts);
  if (age.fromAgeDays !== null && age.staleFrom) {
    push(
      `Current version is about ${formatAgeDays(age.fromAgeDays)} old — delayed upgrades usually carry more integration risk.`,
    );
  }
  if (age.daysBetween !== null && age.wideGap) {
    push(
      `Publish gap for this range is about ${formatAgeDays(age.daysBetween)} — review behaviour that landed in between.`,
    );
  }

  const peers = facts.enrichment?.peers?.summary;
  push(peers);
  const peerCount = peerChangeCount(facts);
  if (!peers && peerCount > 0) {
    push(
      peerCount === 1
        ? "1 peer dependency change in this range — review before installing."
        : `${peerCount} peer dependency changes in this range — review before installing.`,
    );
  }

  const depCount = dependencyChangeCount(facts);
  if (depCount > 0) {
    push(
      depCount === 1
        ? "1 dependency change between manifests — review the diff before installing."
        : `${depCount} dependency changes between manifests — review the graph before installing.`,
    );
  }

  const migration = facts.enrichment?.migration;
  if (migration?.urls?.[0]) {
    push(`Migration / changelog: ${migration.urls[0]}`);
  } else if (facts.details?.github?.changelogUrl) {
    push(`Changelog: ${facts.details.github.changelogUrl}`);
  }

  const highlights = facts.details?.manifestHighlights;
  if (highlights?.moduleType) {
    push(
      `Module format ${highlights.moduleType.from} → ${highlights.moduleType.to}.`,
    );
  }
  if (highlights?.deprecation?.from) {
    push(`Current version is deprecated: ${highlights.deprecation.from}`);
  }

  const runtime = facts.runtime;
  if (runtime?.nodeMessage) {
    push(runtime.nodeMessage);
  } else if (runtime?.nodeEngine) {
    push(`Target requires Node ${runtime.nodeEngine}.`);
  }
  if (runtime?.targetWithinCooldown && runtime.cooldownMessage) {
    push(runtime.cooldownMessage);
  }

  const breakages = breakingItemTexts(facts);
  for (const text of breakages.slice(0, 2)) {
    push(text);
  }

  if (bullets.length === 0) {
    if (facts.details?.breaking?.hasNotes === false) {
      push("No explicit breaking-change notes found for this range.");
    }
    const bump = facts.advice?.bump;
    if (bump === "patch" || bump === "minor") {
      push("Routine bump — review the changelog if the project is sensitive to this package.");
    }
  }

  return bullets.slice(0, 6);
}

function peerAlignLines(facts: UpgradeBriefSeedInput): string[] {
  const fromEnrichment = facts.enrichment?.peers?.align ?? [];
  if (fromEnrichment.length > 0) return fromEnrichment.slice(0, 6);

  return (facts.details?.peers?.changes ?? [])
    .slice(0, 6)
    .map((change) => formatPeerChangeLine(change))
    .filter(Boolean);
}

/**
 * Checklist keyed to the selected from→to range, runtime Node, and peers.
 * Blocking Node upgrades come first so install is not suggested too early.
 */
export function buildContextualNextSteps(
  facts: UpgradeBriefSeedInput,
  packageName: string,
  from: string,
  to: string,
): string[] {
  const steps: string[] = [];
  const runtime = facts.runtime;
  const nodeBlocksInstall =
    Boolean(runtime?.nodeEngine) && runtime?.nodeSatisfies === false;

  if (nodeBlocksInstall && runtime?.node && runtime.nodeEngine) {
    steps.push(
      `Upgrade Node first: runtime ${runtime.node} does not satisfy engines.node ${runtime.nodeEngine} required by ${packageName}@${to}.`,
    );
  } else if (runtime?.nodeEngine && !runtime.node) {
    steps.push(
      `Confirm the runtime meets Node ${runtime.nodeEngine} (required by ${packageName}@${to}) before installing.`,
    );
  }

  const migrationUrl =
    facts.enrichment?.migration?.urls?.[0] ||
    facts.details?.github?.changelogUrl ||
    facts.details?.github?.compareUrl;
  if (migrationUrl) {
    steps.push(
      `Review release notes for ${packageName} ${from} → ${to}: ${migrationUrl}`,
    );
  } else {
    steps.push(
      `Review the changelog for ${packageName} between ${from} and ${to}.`,
    );
  }

  const age = upgradeAgeSignals(facts);
  if (age.veryStale || age.staleFrom || age.wideGap) {
    const bits: string[] = [];
    if (age.fromAgeDays !== null && age.staleFrom) {
      bits.push(`current ${from} is ~${formatAgeDays(age.fromAgeDays)} old`);
    }
    if (age.daysBetween !== null && age.wideGap) {
      bits.push(`range spans ~${formatAgeDays(age.daysBetween)}`);
    }
    steps.push(
      `Plan extra regression coverage for this upgrade${bits.length ? ` (${bits.join("; ")})` : ""} — stale baselines raise integration risk.`,
    );
  }

  if (runtime?.targetWithinCooldown) {
    steps.push(
      `Target ${packageName}@${to} is inside the release cooldown — wait it out or pick an older stable release.`,
    );
  }

  const peers = peerAlignLines(facts);
  const peerCount = peerChangeCount(facts);
  if (peers.length > 0) {
    steps.push(
      `Review and align peer dependencies for ${from} → ${to}: ${peers.slice(0, 4).join("; ")}${peers.length > 4 ? "…" : ""}`,
    );
  } else if (peerCount > 0) {
    steps.push(
      `Review ${peerCount} peer dependency change${peerCount === 1 ? "" : "s"} for ${from} → ${to} before installing.`,
    );
  }

  const depCount = dependencyChangeCount(facts);
  if (depCount >= 5) {
    steps.push(
      `Review the ${depCount} dependency changes between ${packageName}@${from} and ${packageName}@${to} (lockfile and transitive impact).`,
    );
  } else if (depCount > 0) {
    steps.push(
      `Review dependency changes between ${packageName}@${from} and ${packageName}@${to}.`,
    );
  }

  const securityDelta = facts.enrichment?.securityDelta?.delta ?? 0;
  if (securityDelta > 0 && facts.enrichment?.securityDelta?.summary) {
    steps.push(facts.enrichment.securityDelta.summary);
  }

  if (
    runtime?.nodeEngine &&
    runtime.nodeSatisfies === true &&
    runtime.node &&
    !nodeBlocksInstall
  ) {
    steps.push(
      `Keep CI and production on Node ${runtime.node} (satisfies ${runtime.nodeEngine} for ${packageName}@${to}).`,
    );
  }

  steps.push(`Install the target version: \`npm i ${packageName}@${to}\``);
  steps.push("Run the project's tests and typecheck (or build).");

  // Prefer keeping Node + peers + install when the list is long.
  if (steps.length <= 6) return steps;
  const installIdx = steps.findIndex((s) => /npm i /.test(s));
  const mustKeep = new Set<number>();
  if (nodeBlocksInstall) mustKeep.add(0);
  for (let i = 0; i < steps.length; i++) {
    if (/Align peer dependencies|Review and align peer|peer dependency/i.test(steps[i])) {
      mustKeep.add(i);
    }
    if (/dependency changes between/i.test(steps[i])) mustKeep.add(i);
    if (/extra regression coverage|stale baselines/i.test(steps[i])) {
      mustKeep.add(i);
    }
    if (/npm i /.test(steps[i])) mustKeep.add(i);
    if (/tests and typecheck/i.test(steps[i])) mustKeep.add(i);
    if (/Review (release notes|the changelog)/i.test(steps[i])) mustKeep.add(i);
  }
  const picked: string[] = [];
  for (let i = 0; i < steps.length && picked.length < 6; i++) {
    if (mustKeep.has(i) || picked.length < 4 || i >= installIdx) {
      picked.push(steps[i]);
    }
  }
  return picked.slice(0, 6);
}

/**
 * Prefer contextual Node/peer/version steps; keep unique model steps that add detail.
 */
export function mergeUpgradeNextSteps(
  modelSteps: string[] | null | undefined,
  facts: UpgradeBriefSeedInput,
  packageName: string,
  from: string,
  to: string,
): string[] {
  const contextual = buildContextualNextSteps(facts, packageName, from, to);
  const model = (modelSteps ?? []).map((s) => s.trim()).filter(Boolean);

  const coveredKeys = contextual.map((s) => s.toLowerCase());
  const isCovered = (step: string): boolean => {
    const key = step.toLowerCase();
    if (/npm\s+(i|install|add)\b/i.test(step)) return true;
    if (/pnpm\s+add|yarn\s+add/i.test(step)) return true;
    if (/tests and typecheck|run (the )?project/i.test(step)) return true;
    if (/review (the )?(changelog|release notes)/i.test(step)) return true;
    if (/align peer|peer dependenc/i.test(step)) return true;
    if (/dependency changes between|extra regression coverage|stale baselines/i.test(step)) {
      return true;
    }
    if (/\bnode\b/i.test(step) && /engines\.node|upgrade node|runtime/i.test(step)) {
      return coveredKeys.some((c) => c.includes("node"));
    }
    return coveredKeys.some(
      (c) => c.includes(key.slice(0, 48)) || key.includes(c.slice(0, 48)),
    );
  };

  const extras = model.filter((step) => !isCovered(step)).slice(0, 2);
  if (extras.length === 0) return contextual.slice(0, 6);

  const installIdx = contextual.findIndex((s) => /npm i /.test(s));
  if (installIdx <= 0) {
    return [...contextual, ...extras].slice(0, 6);
  }
  return [
    ...contextual.slice(0, installIdx),
    ...extras,
    ...contextual.slice(installIdx),
  ].slice(0, 6);
}

export function buildDeterministicBrief(
  facts: UpgradeBriefSeedInput,
  packageName: string,
  from: string,
  to: string,
): Omit<UpgradeAgentBriefShape, "nextSteps"> & { nextSteps: string[] } {
  const risk = computeUpgradeRisk(facts);
  const bullets = buildSeedBullets(facts);
  const watchFor = buildSeedWatchFor(facts);
  const bump = facts.advice?.bump ?? "upgrade";
  const headline =
    risk === "low"
      ? `${bump} ${from} → ${to} looks straightforward`
      : risk === "high"
        ? `${bump} ${from} → ${to} needs care`
        : `${bump} ${from} → ${to} — review before installing`;

  return {
    headline,
    bullets:
      bullets.length > 0
        ? bullets
        : ["No additional upgrade signals beyond the version bump."],
    risk,
    watchFor,
    nextSteps: buildContextualNextSteps(facts, packageName, from, to),
  };
}

/** Merge model output with deterministic risk/seeds and contextual next steps. */
export function finalizeUpgradeBrief(
  raw: Partial<UpgradeAgentBriefShape> | null | undefined,
  facts: UpgradeBriefSeedInput,
  context?: { packageName: string; from: string; to: string },
): UpgradeAgentBriefShape {
  const risk = computeUpgradeRisk(facts);
  const seeds = buildSeedBullets(facts);
  const seedWatch = buildSeedWatchFor(facts);

  const modelBullets = Array.isArray(raw?.bullets)
    ? raw.bullets.map((b) => b.trim()).filter(Boolean).slice(0, 6)
    : [];
  const modelWatch = Array.isArray(raw?.watchFor)
    ? raw.watchFor.map((w) => w.trim()).filter(Boolean).slice(0, 4)
    : [];

  const bullets: string[] = [];
  const seen = new Set<string>();
  const add = (line: string) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bullets.push(line);
  };

  // Prefer concrete model bullets that are not empty paraphrases of the bump.
  for (const line of modelBullets) {
    if (/^(major|minor|patch)\b.*\bupgrade\b/i.test(line) && seeds.length > 0) {
      continue;
    }
    add(line);
  }
  for (const line of seeds) {
    if (bullets.length >= 6) break;
    add(line);
  }
  if (bullets.length === 0) {
    bullets.push(
      "Limited structured output — rely on the breaking notes and peers above.",
    );
  }

  const watchFor: string[] = [];
  const watchSeen = new Set<string>();
  for (const line of [...modelWatch, ...seedWatch]) {
    const key = line.toLowerCase();
    if (watchSeen.has(key)) continue;
    watchSeen.add(key);
    watchFor.push(line);
    if (watchFor.length >= 4) break;
  }

  const headline =
    raw?.headline?.trim() ||
    (risk === "low"
      ? "Upgrade looks straightforward"
      : risk === "high"
        ? "Upgrade needs care"
        : "Review before upgrading");

  const modelNextSteps = Array.isArray(raw?.nextSteps)
    ? raw.nextSteps.map((s) => s.trim()).filter(Boolean)
    : [];

  const nextSteps = context
    ? mergeUpgradeNextSteps(
        modelNextSteps,
        facts,
        context.packageName,
        context.from,
        context.to,
      )
    : modelNextSteps.length > 0
      ? modelNextSteps.slice(0, 6)
      : [
          "Review the breaking-change notes and peer dependency changes for this range.",
        ];

  return {
    headline,
    bullets: bullets.slice(0, 6),
    risk,
    watchFor,
    nextSteps,
  };
}
