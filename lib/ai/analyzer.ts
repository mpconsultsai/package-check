import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import type { PackageAnalysisResult } from '../types/package-data';
import { formatBytes } from '../utils/format';
import {
  normalizeNpmPackageName,
  validatePackageNameForEcosystem,
} from '../packages/validation';
import { registryLabel, type PackageEcosystem } from '../packages/package-routes';
import { isDotnetInboxPackageId, isStableDotnetPlatformPackage } from '../nuget/dotnet-platform';
import {
  npmMaintainerNames,
  npmModuleFormatLabel,
} from '../packages/npm-package-facts';
import { classifyRuntimeEnvironment } from '../packages/runtime-environment';
import type { RuntimeKind } from '../packages/runtime-environment';
import { getGroqModel, groqModelLabel } from './groq-config';
import { loadPackageUsageBrief } from '../db/package-usage';
import type { OpenSSFScorecard } from '../data-fetchers/openssf-scorecard';
import type { ReviewFacts } from './review-agent';

/**
 * AI-generated package analysis and recommendations
 */
export interface AIPackageAnalysis {
  summary: string;
  recommendation:
    | "recommended"
    | "use-with-caution"
    | "not-recommended"
    | "do-not-use";
  strengths: string[];
  concerns: string[];
  overallScore: number; // 0-100
  securityRating: "excellent" | "good" | "fair" | "poor";
  qualityRating: "excellent" | "good" | "fair" | "poor";
  maintenanceRating: "excellent" | "good" | "fair" | "poor";
  reasoning: string;
  /** npm package names that are genuine alternatives, not ecosystem add-ons */
  competitors?: string[];
  model?: string; // e.g. "Gemini 2.5 Flash", "GPT-OSS 120B (Groq)"
}

const README_DO_NOT_USE_PATTERNS = [
  /\bthis (?:package|project|module|library|repo(?:sitory)?) (?:is|has been) deprecated\b/i,
  /\b(?:package|project) (?:is|has been) (?:officially )?deprecated\b/i,
  /\bno longer maintained\b/i,
  /\bnot (?:being )?actively maintained\b/i,
  /\b(?:this )?(?:package|project) is unmaintained\b/i,
  /\bthis (?:project|package|repo(?:sitory)?) is archived\b/i,
  /\bend[- ]of[- ]life\b/i,
  /\bdeprecated\.?\s+(?:please |kindly )?(?:use|install|switch to)\b/i,
];

interface PackageHealthFlags {
  deprecated: boolean;
  archived: boolean;
  unmaintained: boolean;
  reasons: string[];
}

function detectPackageHealthFlags(data: PackageAnalysisResult): PackageHealthFlags {
  const reasons: string[] = [];
  const deprecatedMessage = data.npm?.deprecated?.trim();
  const deprecated = Boolean(deprecatedMessage);
  if (deprecated) {
    reasons.push(
      deprecatedMessage!.length > 160
        ? `Registry marks this package as deprecated: ${deprecatedMessage!.slice(0, 157)}…`
        : `Registry marks this package as deprecated: ${deprecatedMessage}`,
    );
  }

  const archived = Boolean(data.github?.archived);
  if (archived) {
    reasons.push("The GitHub repository is archived.");
  }

  const readme = data.readme ?? "";
  const readmeWarning = README_DO_NOT_USE_PATTERNS.some((pattern) =>
    pattern.test(readme),
  );
  if (readmeWarning && !deprecated) {
    reasons.push(
      "The README contains a deprecation, archive, or migration warning.",
    );
  }

  const lastPublished =
    data.npm?.time && data.npm.version ? data.npm.time[data.npm.version] : null;
  const daysSincePublish = daysSince(lastPublished);
  const daysSinceCommit = daysSince(data.github?.pushed_at);
  const adoption = adoptionLevel(
    data.downloads?.downloads,
    data.github?.stars,
    data.popularity?.dependents,
  );
  const maintenanceScore = data.popularity?.maintenanceScore;
  const completeUtility = isLikelyCompleteUtility(data);

  const longSilent =
    daysSincePublish !== null &&
    daysSincePublish >= 730 &&
    (daysSinceCommit === null || daysSinceCommit >= 365);
  const lowMaintenance =
    typeof maintenanceScore === "number" && maintenanceScore < 0.15;
  const unmaintained =
    !deprecated &&
    !archived &&
    (readmeWarning ||
      (!completeUtility &&
        ((longSilent && adoption !== "widely-adopted") ||
          (longSilent && lowMaintenance))));

  if (unmaintained && !readmeWarning) {
    const daysPart =
      daysSincePublish !== null
        ? ` (${daysSincePublish} days since last publish)`
        : "";
    reasons.push(
      `No meaningful maintenance activity for a long time${daysPart} - this package appears unmaintained.`,
    );
  } else if (unmaintained && readmeWarning && reasons.length === 0) {
    reasons.push(
      "The package appears unmaintained based on its README and release history.",
    );
  }

  return {
    deprecated,
    archived,
    unmaintained,
    reasons,
  };
}

/** Group near-duplicate concern lines (e.g. two unmaintained notes) under one theme. */
function concernTheme(text: string): string | null {
  const t = text.toLowerCase();
  if (
    /unmaintain|no meaningful maintenance|maintenance activity|days since (?:its )?last publish|days since publish|abandon|not actively maintained|no longer maintained|lack of (?:any )?activity|lack of future support|not suitable for use in new projects/.test(
      t,
    )
  ) {
    return "maintenance";
  }
  if (/deprecat|end[- ]of[- ]life|migration warning/.test(t)) {
    return "deprecated";
  }
  if (/\barchiv/.test(t)) {
    return "archived";
  }
  if (/bundle|gzip|minified|payload|bundlephobia/.test(t)) {
    return "bundle";
  }
  if (/vulnerab|security advisory|\bcve\b|critical\/high/.test(t)) {
    return "security";
  }
  if (/do not use this package|poses a significant risk/.test(t)) {
    return "do-not-use-lead";
  }
  return null;
}

function dedupeConcerns(concerns: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of concerns) {
    const text = raw.trim();
    if (!text || text.toLowerCase() === "none") continue;

    const theme = concernTheme(text);
    const key =
      theme ??
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

/**
 * Build a single reasoning paragraph without repeating the same themes
 * (e.g. unmaintained called out by both our override and the model).
 */
function mergeReasoning(preferred: string[], aiReasoning: string): string {
  const seenThemes = new Set<string>();
  const parts: string[] = [];

  const remember = (text: string) => {
    const theme = concernTheme(text);
    if (theme) seenThemes.add(theme);
    if (/^do not use this package/i.test(text.trim())) {
      seenThemes.add("do-not-use-lead");
    }
  };

  const push = (raw: string) => {
    let text = raw.trim().replace(/\s+/g, " ");
    if (!text) return;

    if (/^do not use this package/i.test(text)) {
      if (seenThemes.has("do-not-use-lead")) return;
      seenThemes.add("do-not-use-lead");
    }

    const theme = concernTheme(text);
    if (theme && seenThemes.has(theme)) return;

    remember(text);
    if (!/[.!?]$/.test(text)) text = `${text}.`;
    parts.push(text);
  };

  for (const part of preferred) {
    push(part);
  }

  const sentences = aiReasoning
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    push(sentence);
  }

  return parts.join(" ");
}

function normalizeRecommendation(
  value: unknown,
): AIPackageAnalysis["recommendation"] {
  const raw = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (
    raw === "do-not-use" ||
    raw === "do not use" ||
    raw === "dont-use" ||
    raw === "don't-use"
  ) {
    return "do-not-use";
  }
  if (raw === "not-recommended" || raw === "not recommended") {
    return "not-recommended";
  }
  if (raw === "use-with-caution" || raw === "use with caution") {
    return "use-with-caution";
  }
  if (raw === "recommended") {
    return "recommended";
  }
  return "use-with-caution";
}

/**
 * Force a hard negative recommendation when package is deprecated,
 * archived, or clearly unmaintained - do not trust the model alone.
 */
function applyHealthRecommendationOverrides(
  analysis: AIPackageAnalysis,
  flags: PackageHealthFlags,
): AIPackageAnalysis {
  const shouldBlock =
    flags.deprecated || flags.archived || flags.unmaintained;
  if (!shouldBlock) {
    if (analysis.recommendation === "not-recommended") {
      return { ...analysis, recommendation: "do-not-use" };
    }
    return analysis;
  }

  const concerns = dedupeConcerns([
    ...flags.reasons,
    ...analysis.concerns,
  ]).slice(0, 5);

  return {
    ...analysis,
    recommendation: "do-not-use",
    maintenanceRating: "poor",
    overallScore: Math.min(analysis.overallScore, flags.deprecated || flags.archived ? 25 : 35),
    concerns: concerns.length > 0 ? concerns : ["Package appears unsafe to adopt for new work."],
    // Keep reasons in concerns only - do not also paste them into reasoning
    reasoning: mergeReasoning(
      ["Do not use this package for new projects"],
      analysis.reasoning || "",
    ),
  };
}

function applyStableDotnetPlatformReview(
  analysis: AIPackageAnalysis,
  data: PackageAnalysisResult,
): AIPackageAnalysis {
  if (!isStableDotnetPlatformPackage(data)) return analysis;
  const flags = detectPackageHealthFlags(data);
  if (flags.deprecated || flags.archived) return analysis;
  if ((data.security?.totalCount ?? 0) > 0) return analysis;

  const concerns = dedupeConcerns(
    analysis.concerns.filter((item) => {
      if (concernTheme(item) === "maintenance") return false;
      return !/^none$/i.test(item.trim());
    }),
  );
  const maintenanceRating =
    analysis.maintenanceRating === "poor" ||
    analysis.maintenanceRating === "fair"
      ? "good"
      : analysis.maintenanceRating;
  const name = data.npm?.name || data.packageName;
  const downloads = data.downloads?.downloads?.toLocaleString() ?? "very high";
  const lifted = analysis.recommendation !== "recommended";

  return {
    ...analysis,
    recommendation: "recommended",
    maintenanceRating,
    concerns,
    reasoning: lifted
      ? `${name} is a .NET platform package with ${downloads} lifetime downloads and no advisories on this version. The older publish date reflects a stable inbox assembly.`
      : analysis.reasoning,
  };
}

type BundleSizeLevel = "ok" | "notable" | "large" | "very-large";

function packageRuntimeKind(data: PackageAnalysisResult): RuntimeKind {
  const npm = data.npm;
  return classifyRuntimeEnvironment({
    name: npm?.name ?? data.packageName,
    description: npm?.description,
    keywords: npm?.keywords,
    dependencies: npm?.dependencies,
    peerDependencies: npm?.peerDependencies,
    browser: npm?.browser,
    bin: npm?.bin,
    engines: npm?.engines,
    exports: npm?.exports,
    hasBrowserBundle:
      data.bundleSize != null
        ? true
        : data.errors?.bundleSize
          ? false
          : undefined,
  }).kind;
}

function isBrowserBundleRelevant(kind: RuntimeKind): boolean {
  return kind === "client" || kind === "both" || kind === "unclear";
}

function isBundleConcernText(text: string): boolean {
  return /bundle|gzip|minified|payload|bundlephobia/i.test(text);
}

function assessBundleSize(data: PackageAnalysisResult): {
  level: BundleSizeLevel | null;
  note: string | null;
  gzip: number | null;
  size: number | null;
} {
  const size = data.bundleSize?.size;
  const gzip = data.bundleSize?.gzip;
  if (
    size === undefined ||
    gzip === undefined ||
    !Number.isFinite(size) ||
    !Number.isFinite(gzip)
  ) {
    return { level: null, note: null, gzip: null, size: null };
  }

  if (gzip >= 200_000 || size >= 500_000) {
    return {
      level: "very-large",
      note: `Very large browser bundle (${formatBytes(gzip)} gzip / ${formatBytes(size)} minified) - likely to hurt client-side load performance.`,
      gzip,
      size,
    };
  }
  if (gzip >= 100_000 || size >= 250_000) {
    return {
      level: "large",
      note: `Large browser bundle (${formatBytes(gzip)} gzip / ${formatBytes(size)} minified) - may affect page load performance in the browser.`,
      gzip,
      size,
    };
  }
  if (gzip >= 50_000) {
    return {
      level: "notable",
      note: `Notable browser bundle size (${formatBytes(gzip)} gzip / ${formatBytes(size)} minified).`,
      gzip,
      size,
    };
  }
  return {
    level: "ok",
    note: null,
    gzip,
    size,
  };
}

/**
 * Ensure large/very-large bundles are called out in AI concerns -
 * but not for packages that look server-only (browser payload is less relevant).
 */
function applyBundleSizeNotes(
  analysis: AIPackageAnalysis,
  data: PackageAnalysisResult,
): AIPackageAnalysis {
  const runtimeKind = packageRuntimeKind(data);

  // Browser bundle size comes from Bundlephobia and only exists for npm.
  if ((data.ecosystem ?? "npm") !== "npm" || !isBrowserBundleRelevant(runtimeKind)) {
    const filtered = analysis.concerns.filter(
      (c) => c && c.toLowerCase() !== "none" && !isBundleConcernText(c),
    );
    return {
      ...analysis,
      concerns: filtered.length > 0 ? filtered : ["None"],
    };
  }

  const assessment = assessBundleSize(data);
  if (
    !assessment.note ||
    (assessment.level !== "large" && assessment.level !== "very-large")
  ) {
    return analysis;
  }

  const alreadyNoted = analysis.concerns.some((c) => isBundleConcernText(c));
  if (alreadyNoted) {
    return analysis;
  }

  const concerns = analysis.concerns.filter(
    (c) => c && c.toLowerCase() !== "none",
  );
  return {
    ...analysis,
    concerns: [assessment.note, ...concerns].slice(0, 5),
  };
}

/** Drop reasoning sentences that restate concerns (theme or near-duplicate text). */
function stripReasoningOverlap(
  reasoning: string,
  concerns: string[],
): string {
  if (!reasoning.trim()) return reasoning;

  const themes = new Set(
    concerns
      .map((c) => concernTheme(c))
      .filter((t): t is string => Boolean(t)),
  );
  const concernNorms = concerns
    .map((c) =>
      c
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
    )
    .filter((c) => c.length > 12);

  const kept = reasoning
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((sentence) => {
      const theme = concernTheme(sentence);
      if (theme && themes.has(theme)) return false;

      const norm = sentence
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      return !concernNorms.some(
        (c) =>
          norm.includes(c) ||
          c.includes(norm) ||
          tokenOverlap(norm, c) >= 0.65,
      );
    });

  const out = kept.join(" ").trim();
  if (out) return out;
  if (concerns.length > 0) {
    return "The recommendation below is based on the concerns in this review.";
  }
  return reasoning.trim();
}

function tokenOverlap(a: string, b: string): number {
  const as = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  const bs = new Set(b.split(/\s+/).filter((w) => w.length > 3));
  if (as.size === 0 || bs.size === 0) return 0;
  let hit = 0;
  for (const w of as) {
    if (bs.has(w)) hit += 1;
  }
  return hit / Math.min(as.size, bs.size);
}

/** User-facing AI copy should not spotlight OpenSSF Scorecard by name. */
const SCORECARD_PROSE =
  /\b(open\s*ssf|ossf|scorecard\.dev|openssf scorecard|scorecard (?:score|check|rating|result|grade))\b/i;

function mentionsScorecard(text: string): boolean {
  return SCORECARD_PROSE.test(text);
}

function softenScorecardProse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !mentionsScorecard(trimmed)) return trimmed;
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !mentionsScorecard(sentence));
  if (kept.length > 0) return kept.join(" ").trim();
  return trimmed
    .replace(/\bOpenSSF Scorecard\b/gi, "repository hygiene")
    .replace(/\bscorecard\.dev\b/gi, "repository signals")
    .replace(/\bScorecard\b/gi, "repository hygiene");
}

function filterScorecardBullets(items: string[] | undefined): string[] {
  if (!items?.length) return [];
  return items.filter((item) => !mentionsScorecard(item));
}

function withoutBrowserBundleSentences(
  text: string,
  ecosystem: PackageEcosystem,
): string {
  if (ecosystem === "npm" || !text.trim()) return text;
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !isBundleConcernText(sentence));
  return kept.length > 0 ? kept.join(" ") : text;
}

function finalizeAiAnalysis(
  analysis: AIPackageAnalysis,
  data: PackageAnalysisResult,
): AIPackageAnalysis {
  const ecosystem = data.ecosystem ?? "npm";
  const withHealth = applyStableDotnetPlatformReview(
    applyHealthRecommendationOverrides(
      analysis,
      detectPackageHealthFlags(data),
    ),
    data,
  );
  const withBundle = applyBundleSizeNotes(withHealth, data);
  const concerns = dedupeConcerns(filterScorecardBullets(withBundle.concerns)).slice(
    0,
    5,
  );
  return {
    ...withBundle,
    summary: withoutBrowserBundleSentences(
      softenScorecardProse(withBundle.summary),
      ecosystem,
    ),
    strengths: filterScorecardBullets(withBundle.strengths).filter(
      (item) => ecosystem === "npm" || !isBundleConcernText(item),
    ),
    concerns,
    reasoning: withoutBrowserBundleSentences(
      stripReasoningOverlap(
        softenScorecardProse(withBundle.reasoning || ""),
        concerns,
      ),
      ecosystem,
    ),
  };
}

/**
 * Initialize Gemini AI model
 */
function getAIModel(modelName: string = 'gemini-2.5-flash') {
  const apiKey = process.env.GOOGLE_API_KEY;
  
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not configured');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // Use Gemini 2.5 Flash by default, fallback to Flash-Lite for higher rate limits
  return genAI.getGenerativeModel({ model: modelName });
}

/**
 * Initialize Groq AI client (fallback option)
 */
function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  return new Groq({ apiKey });
}

/** Rate limits, overload, and temporary Gemini outages should fall through the provider chain. */
function isGeminiCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  return (
    /\b429\b/.test(message) ||
    /\b503\b/.test(message) ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted') ||
    lower.includes('service unavailable') ||
    lower.includes('high demand') ||
    lower.includes('try again later') ||
    lower.includes('overloaded')
  );
}

async function analyzeWithGroq(
  systemPrompt: string,
  prompt: string,
  data: PackageAnalysisResult,
): Promise<AIPackageAnalysis> {
  const groqClient = getGroqClient();
  const model = getGroqModel();
  const chatCompletion = await groqClient.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    model,
    temperature: 0.7,
    max_tokens: 2048,
  });

  const text = chatCompletion.choices[0]?.message?.content || '';
  const aiAnalysis = parseAIResponse(
    text,
    data.packageName,
    data.ecosystem ?? "npm",
  );
  aiAnalysis.model = groqModelLabel(model);
  console.log(`✓ Analysis completed with Groq (${aiAnalysis.model})`);
  return finalizeAiAnalysis(aiAnalysis, data);
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return Number.isFinite(days) ? days : null;
}

const COMPLETE_UTILITY_TEXT =
  /\b(math|mathematic|algorithm|numeric|number|precision|decimal|bigint|statistics|statistical|ieee|754|floating|matrix|vector|hash|crc|checksum|constant|encode|decode|uuid|slug|semver|normalize|is-even|is-odd|prime|factorial|combinator|probability|tensor|linear algebra|trigonometry|geometry)\b/i;

/** Narrow, often "done" libraries (math, tiny utils) - slow releases are normal. */
function isLikelyCompleteUtility(data: PackageAnalysisResult): boolean {
  const npm = data.npm;
  const text = [
    npm?.description ?? "",
    ...(npm?.keywords ?? []),
    data.packageName.replace(/^@[^/]+\//, ""),
  ]
    .join(" ")
    .toLowerCase();
  if (!COMPLETE_UTILITY_TEXT.test(text)) return false;
  const runtimeDeps = Object.keys(npm?.dependencies ?? {}).length;
  return runtimeDeps <= 10;
}

function adoptionLevel(
  monthlyDownloads?: number,
  stars?: number,
  dependents?: number
): 'widely-adopted' | 'moderate' | 'niche' {
  if (
    (monthlyDownloads ?? 0) >= 1_000_000 ||
    (stars ?? 0) >= 5_000 ||
    (dependents ?? 0) >= 1_000
  ) {
    return 'widely-adopted';
  }
  if (
    (monthlyDownloads ?? 0) >= 50_000 ||
    (stars ?? 0) >= 200 ||
    (dependents ?? 0) >= 50
  ) {
    return 'moderate';
  }
  return 'niche';
}

function formatScorecardForPrompt(scorecard: OpenSSFScorecard): string {
  const applicable = scorecard.checks.filter((c) => c.score >= 0);
  const weakCount = applicable.filter((c) => c.score < 5).length;
  const overall =
    scorecard.overallScore != null
      ? `${scorecard.overallScore.toFixed(1)}/10`
      : "n/a";
  return `overall=${overall}; weakSignals=${weakCount}/${applicable.length}`;
}

function maintenanceContext(
  daysSincePublish: number | null,
  daysSinceCommit: number | null,
  adoption: ReturnType<typeof adoptionLevel>,
  completeUtility: boolean,
): string {
  const publish = daysSincePublish;
  const commit = daysSinceCommit;
  const popular = adoption === 'widely-adopted';

  if (publish === null) {
    return 'unknown publish date - do not infer abandonment';
  }
  if (publish < 90) {
    return `healthy (${publish}d since publish). Not stale; never use-with-caution for cadence alone.`;
  }
  if (publish < 180) {
    return popular
      ? `normal for mature/widely used (${publish}d). Not stale; cadence alone ≠ caution.`
      : `acceptable (${publish}d). Not stale; mild note only if other risks exist.`;
  }
  if (publish < 365) {
    if (completeUtility) {
      return `mature narrow utility (${publish}d). Single-purpose/math-style packages are often feature-complete; slow cadence is expected.`;
    }
    if (popular && (commit === null || commit < 180)) {
      return `mature/stable (${publish}d). Months between releases OK for widely adopted; treat as maintained unless README says otherwise.`;
    }
    return `slow (${publish}d). Caution only with vulns, deprecation, or no commits.`;
  }
  if (completeUtility && !popular) {
    return `long gap (${publish}d) but likely complete micro-library - judge on security/adoption, not release frequency alone.`;
  }
  if (popular && commit !== null && commit < 90) {
    return `long publish gap (${publish}d) but recent git - often stable major, not abandonment.`;
  }
  if (completeUtility && popular) {
    return `long gap (${publish}d) on widely used narrow utility - often stable/finished; excellent/good maintenance OK if secure.`;
  }
  if (publish >= 365 && (commit === null || commit >= 180) && !popular) {
    return `likely unmaintained (${publish}d since publish) - may justify caution or do-not-use.`;
  }
  return `long publish gap (${publish}d). Popular + secure may still be recommended with a maintenance note.`;
}

/**
 * Create a prompt for package analysis (kept compact to limit tokens).
 */
function createAnalysisPrompt(
  data: PackageAnalysisResult,
  scorecard: OpenSSFScorecard | null,
  usageLine: string | null = null,
  facts: Pick<ReviewFacts, "advisoryLines" | "dependencyLines" | "installScriptLines"> | null = null,
): string {
  const {
    packageName,
    ecosystem = "npm",
    npm,
    downloads,
    github,
    security,
    readme,
    popularity,
    bundleSize,
  } = data;
  const registryLabelName = registryLabel(ecosystem);

  const lastPublished =
    npm?.time && npm.version ? npm.time[npm.version] : null;
  const daysSincePublish = daysSince(lastPublished);
  const daysSinceCommit = daysSince(github?.pushed_at);
  const monthlyDownloads = downloads?.downloads;
  const adoption = adoptionLevel(
    monthlyDownloads,
    github?.stars,
    popularity?.dependents,
  );
  const completeUtility = isLikelyCompleteUtility(data);
  const cadenceNote = maintenanceContext(
    daysSincePublish,
    daysSinceCommit,
    adoption,
    completeUtility,
  );

  const lines: string[] = [
    `Analyse ${registryLabelName} package "${packageName}". JSON only.`,
    "",
    `v${npm?.version || "?"}; license ${npm?.license || "?"}`,
    `Desc: ${npm?.description || "none"}`,
  ];

  if (npm?.deprecated) lines.push(`DEPRECATED: ${npm.deprecated}`);
  if (github?.archived) lines.push("GitHub ARCHIVED");
  if (npm?.keywords?.length) {
    lines.push(`Keywords: ${npm.keywords.slice(0, 10).join(", ")}`);
  }
  if (daysSincePublish !== null) {
    lines.push(
      daysSincePublish >= 0
        ? `Days since publish: ${daysSincePublish}`
        : "Published within last day",
    );
  }

  const adoptionBits = [`adoption=${adoption}`];
  if (monthlyDownloads !== undefined) {
    adoptionBits.push(
      data.downloads?.period === "total"
        ? `downloads total=${monthlyDownloads.toLocaleString()}`
        : `downloads/mo=${monthlyDownloads.toLocaleString()}`,
    );
  }
  if (popularity?.dependents !== undefined) {
    adoptionBits.push(`dependents=${popularity.dependents.toLocaleString()}`);
  }
  if (popularity && ecosystem === "npm") {
    adoptionBits.push(
      `npm scores p/q/m=${popularity.popularityScore}/${popularity.qualityScore}/${popularity.maintenanceScore}`,
    );
  }
  lines.push(adoptionBits.join("; "));

  if (github) {
    const gh = [
      `stars=${github.stars.toLocaleString()}`,
      `forks=${github.forks.toLocaleString()}`,
      `openIssues=${github.open_issues.toLocaleString()}`,
      `lang=${github.language || "?"}`,
    ];
    if (daysSinceCommit !== null) {
      gh.push(
        daysSinceCommit >= 0
          ? `daysSinceCommit=${daysSinceCommit}`
          : "committed within last day",
      );
    }
    lines.push(`GitHub: ${gh.join("; ")}`);
  }

  lines.push(`Maintenance (authoritative): ${cadenceNote}`);
  if (isStableDotnetPlatformPackage(data)) {
    lines.push(
      "Profile: stable .NET platform package (System.* or Microsoft.*). Lifetime downloads are the adoption signal. A publish date years ago is normal for an inbox assembly. When advisories are clear, recommendation=recommended and maintenanceRating=good or excellent. Do not list age, a long publish gap, or infrequent releases as a concern.",
    );
  }
  if (completeUtility) {
    lines.push(
      "Profile: likely complete/narrow utility (math, algorithm, or single-purpose). Do not penalize maintenance for lack of frequent releases unless security/README say otherwise.",
    );
  }

  if (scorecard) {
    lines.push(
      `Background repo hygiene (internal only, do not name in output): ${formatScorecardForPrompt(scorecard)}`,
    );
  }

  if (usageLine) {
    lines.push(
      "Background usage (internal only; do not quote counts or this note in summary, strengths, concerns, or reasoning). Counts measure interest, not quality. A small count is not a concern. Also-shown names may be competitors only when they do the same job:",
      usageLine,
    );
  }

  if (security) {
    lines.push(
      `Vulns total=${security.totalCount} (crit=${security.critical}, high=${security.high}, mod=${security.moderate}, low=${security.low})`,
    );
  }
  if (facts?.advisoryLines.length) {
    lines.push("Advisories affecting this version:");
    for (const line of facts.advisoryLines) lines.push(`- ${line}`);
  }
  if (facts?.dependencyLines.length) {
    lines.push("Dependencies:");
    if (facts.dependencyLines.some((line) => line.includes("has advisories"))) {
      lines.push(
        "Mention a direct dependency in concerns when its line says it has advisories.",
      );
    }
    for (const line of facts.dependencyLines) lines.push(`- ${line}`);
  }
  if (facts?.installScriptLines.length) {
    lines.push(
      "Install scripts run on the user's machine during npm install. Mention one in concerns when it downloads or executes code:",
    );
    for (const line of facts.installScriptLines) lines.push(`- ${line}`);
  }

  if (ecosystem === "npm") {
    const runtimeKind = packageRuntimeKind(data);
    const runtimeLabel =
      runtimeKind === "client"
        ? "client (browser)"
        : runtimeKind === "server"
          ? "server / Node (not primarily browser)"
          : runtimeKind === "both"
            ? "client and server (isomorphic / dual)"
            : "unclear (treat browser bundle cautiously if present)";
    lines.push(`Runtime target (heuristic): ${runtimeLabel}`);

    if (data.npm?.moduleFormat) {
      lines.push(
        `Module format: ${npmModuleFormatLabel(data.npm.moduleFormat)}. State it as a fact. Do not lower the recommendation because a package is CommonJS.`,
      );
    }
    if (typeof data.npm?.typesIncluded === "boolean") {
      lines.push(
        data.npm.typesIncluded
          ? "TypeScript types: included in the package."
          : "TypeScript types: not included. A separate @types package may be required. Mention this as a fact, not a concern, unless the package is a TypeScript library.",
      );
    }
    const maintainers = npmMaintainerNames(data.npm?.maintainers);
    if (maintainers.length > 0) {
      lines.push(
        `Maintainers (${maintainers.length}): ${maintainers.slice(0, 12).join(", ")}`,
      );
    }

    const bundleAssessment = assessBundleSize(data);
    if (bundleSize && bundleAssessment.gzip !== null && bundleAssessment.size !== null) {
      const composition = (data.bundleSize?.composition ?? [])
        .map((mod) => `${mod.name} ${Math.round(mod.share * 100)}%`)
        .join(", ");
      let bundleLine = `Bundle: ${formatBytes(bundleAssessment.size)} min / ${formatBytes(bundleAssessment.gzip)} gzip (${bundleAssessment.level})`;
      if (composition) bundleLine += `. Largest modules: ${composition}`;
      if (runtimeKind === "server") {
        bundleLine +=
          " - server-oriented package: do NOT list browser bundle size or these modules as a concern";
      } else if (bundleAssessment.level === "large" || bundleAssessment.level === "very-large") {
        bundleLine += " - MUST list in concerns for browser/client use; not a strength";
      } else if (bundleAssessment.level === "notable") {
        bundleLine += " - optional concern if front-end relevant";
      }
      lines.push(bundleLine);
    }
  }

  if (readme) {
    lines.push("", "README (excerpt):", readme, "");
    lines.push(
      "From README: infer what/who/how; if deprecation, migration, archive, EOL, or unmaintained → recommendation do-not-use.",
    );
  }

  const healthFlags = detectPackageHealthFlags(data);
  if (healthFlags.deprecated || healthFlags.archived || healthFlags.unmaintained) {
    lines.push("HARD FLAGS (do-not-use + maintenanceRating=poor; put in concerns):");
    for (const reason of healthFlags.reasons) {
      lines.push(`- ${reason}`);
    }
  }

  lines.push(
    "",
    "Rules:",
    "- Weigh security, adoption, quality, true abandonment - not normal publish gaps on popular packages.",
    "- <90d since publish is healthy. Widely adopted packages often go months between releases.",
    "- use-with-caution: concrete risk (unpatched high/crit vulns, likely malware/typosquat, niche + worrying signals).",
    "- do-not-use: deprecated, archived, README deprecation/migration, or clearly unmaintained.",
    ecosystem === "npm"
      ? "- Large/very-large browser bundle → concerns only when runtime is client, both, or unclear. Server-only → ignore browser bundle size."
      : "- Do not mention browser bundles, Bundlephobia, minified size, gzip payload, or client-side app load. This package is not distributed as a JavaScript bundle.",
    "- High open issues on huge repos ≠ red flag alone.",
    "- No cadence padding in concerns when healthy; use [\"None\"] if none. Score: no penalty for normal cadence on widely adopted.",
    "- Maintenance rating: excellent ~<90d or widely adopted + recent commits; good ~6mo (or longer if popular+secure); fair/poor only for real inactivity.",
    "- Complete micro-libraries (math, algorithms, tiny single-purpose utils): maintenance can be good/excellent when stable, adopted, and secure - no ongoing feature work expected.",
    "- Background repo hygiene may lightly inform securityRating/quality only. Do NOT mention OpenSSF, Scorecard, scorecard.dev, or named hygiene checks in summary, strengths, concerns, or reasoning. Low hygiene alone is not do-not-use if advisories are clean and the package is mature.",
    "",
    "Fields:",
    "- summary: 3-4 sentences - what it is, who for / how used, notable capabilities. From desc/keywords/README. No metrics lead (downloads, stars, vulns, publish age). No scorecard product names.",
    "- recommendation: recommended|use-with-caution|not-recommended|do-not-use",
    "- strengths: 3-5 short bullets",
    "- concerns: 2-4 short distinct risk bullets (or [\"None\"]). Facts only - do NOT restate them in reasoning.",
    "- overallScore: 0-100",
    "- securityRating, qualityRating, maintenanceRating: excellent|good|fair|poor",
    "- reasoning: 1-2 sentences WHY the recommendation - tradeoffs / decision. Do NOT repeat concern wording or themes.",
    ecosystem === "pypi"
      ? `- competitors: 4-6 real PyPI alternatives (same job, not plugins/wrappers of this). Exact PyPI project names. Lowercase, no versions. Never "${packageName}".`
      : ecosystem === "nuget"
        ? `- competitors: 4-6 real NuGet alternatives (same job, not plugins/wrappers of this). Exact NuGet package ids. No versions. Never "${packageName}". Never System.* or Microsoft.* package ids.`
        : `- competitors: 4-6 real npm alternatives (same job, not plugins/wrappers of this). Exact registry names with @ if scoped. Lowercase, no versions. Never "${packageName}".`,
    "",
    "JSON shape:",
    '{"summary":"","recommendation":"","strengths":[],"concerns":[],"overallScore":0,"securityRating":"","qualityRating":"","maintenanceRating":"","reasoning":"","competitors":[]}',
    "No text outside JSON. ASCII spaces/hyphens only.",
  );

  return lines.join("\n");
}

function normalizeAiPunctuation(text: string): string {
  return text
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*[\u2013\u2014\u2015]\s*/g, ' - ')
    .replace(/[\u2010\u2011\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/ {2,}/g, ' ');
}

function normalizeAiString(value: unknown): string {
  return typeof value === 'string' ? normalizeAiPunctuation(value).trim() : '';
}

/**
 * Parse AI response into structured format
 */
function parseCompetitorNames(
  value: unknown,
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>([packageName.toLowerCase()]);
  const names: string[] = [];
  for (const entry of raw) {
    const normalized =
      ecosystem === "npm"
        ? normalizeNpmPackageName(normalizeAiString(entry))
        : ecosystem === "pypi"
          ? normalizeAiString(entry).toLowerCase()
          : normalizeAiString(entry);
    const name = normalized;
    const key = name.toLowerCase();
    if (
      !name ||
      seen.has(key) ||
      (ecosystem === "nuget" && isDotnetInboxPackageId(name)) ||
      !validatePackageNameForEcosystem(name, ecosystem).valid
    )
      continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 6) break;
  }
  return names;
}

function parseAIResponse(
  response: string,
  packageName: string,
  ecosystem: PackageEcosystem = "npm",
): AIPackageAnalysis {
  try {
    // Remove markdown code blocks if present
    const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Try to extract JSON from the response
    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    let jsonString = jsonMatch[0];
    
    // Clean up common JSON issues from AI responses
    jsonString = jsonString.replace(/,(\s*[\]}])/g, '$1');
    jsonString = normalizeAiPunctuation(jsonString);
    
    const parsed = JSON.parse(jsonString);
    
    const strengths = Array.isArray(parsed.strengths) 
      ? parsed.strengths
          .map((s: unknown) => normalizeAiString(s))
          .filter(Boolean)
      : (parsed.strengths
        ? [normalizeAiString(parsed.strengths)].filter(Boolean)
        : []);
    
    const concerns = Array.isArray(parsed.concerns) 
      ? parsed.concerns
          .map((c: unknown) => normalizeAiString(c))
          .filter(Boolean)
      : (parsed.concerns
        ? [normalizeAiString(parsed.concerns)].filter(Boolean)
        : []);

    return {
      summary: normalizeAiString(parsed.summary),
      recommendation: normalizeRecommendation(parsed.recommendation),
      strengths: strengths.length > 0 ? strengths : ['Unable to identify specific strengths from data'],
      concerns: concerns.length > 0 ? concerns : ['Unable to identify specific concerns from data'],
      overallScore: Number(parsed.overallScore) || 50,
      securityRating: parsed.securityRating || 'fair',
      qualityRating: parsed.qualityRating || 'fair',
      maintenanceRating: parsed.maintenanceRating || 'fair',
      reasoning: normalizeAiString(parsed.reasoning) || normalizeAiString(parsed.summary) || 'Analysis based on package metrics',
      competitors: parseCompetitorNames(
        parsed.competitors,
        packageName,
        ecosystem,
      ),
    };
  } catch (error) {
    console.error('Failed to parse AI response:', error);
    console.error('Response was:', response);
    // Return a safe default
    return {
      summary: 'Unable to generate AI analysis at this time.',
      recommendation: 'use-with-caution',
      strengths: ['Package data available for manual review'],
      concerns: ['AI analysis temporarily unavailable'],
      overallScore: 50,
      securityRating: 'fair',
      qualityRating: 'fair',
      maintenanceRating: 'fair',
      reasoning: 'Please review the package metrics manually.',
      competitors: [],
    };
  }
}

/**
 * Analyze a package using AI with automatic fallback:
 * Gemini Flash → Flash-Lite → Groq on rate limits / capacity errors (429, 503, etc.)
 */
async function synthesizePackageReview(
  data: PackageAnalysisResult,
  facts: ReviewFacts,
): Promise<AIPackageAnalysis> {
  const usageLine = await loadPackageUsageBrief(
    data.ecosystem ?? "npm",
    data.packageName,
  );
  const prompt = createAnalysisPrompt(data, facts.scorecard, usageLine, facts);

  const registryName = registryLabel(data.ecosystem ?? "npm");
  const systemPrompt =
    `Expert engineer advising on ${registryName} package adoption. ` +
    'Summary = what it is/for (from desc/README), not a metrics recap. ' +
    'Normal publish gaps on popular or feature-complete narrow libraries are not caution. ' +
    `Weigh ${registryName} advisories and maintainer signals; never highlight OpenSSF Scorecard in user-facing text. JSON only.`;

  const fullPrompt = `${systemPrompt}\n\n${prompt}`;

  // Try Gemini 2.5 Flash first
  try {
    console.log('Attempting analysis with Gemini 2.5 Flash...');
    const model = getAIModel('gemini-2.5-flash');
    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const text = response.text();
    
    const aiAnalysis = parseAIResponse(
    text,
    data.packageName,
    data.ecosystem ?? "npm",
  );
    aiAnalysis.model = 'Gemini 2.5 Flash';
    console.log('✓ Analysis completed with Gemini 2.5 Flash');
    return finalizeAiAnalysis(aiAnalysis, data);
  } catch (error: unknown) {
    if (!isGeminiCapacityError(error)) {
      console.error('AI analysis failed:', error);
      throw new Error(
        `Failed to analyze package with AI: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    console.warn('⚠ Gemini Flash unavailable (rate/capacity), falling back to Flash-Lite...');

    try {
      const fallbackModel = getAIModel('gemini-2.5-flash-lite');
      const result = await fallbackModel.generateContent(fullPrompt);
      const response = result.response;
      const text = response.text();

      const aiAnalysis = parseAIResponse(
    text,
    data.packageName,
    data.ecosystem ?? "npm",
  );
      aiAnalysis.model = 'Gemini 2.5 Flash Lite';
      console.log('✓ Analysis completed with Gemini 2.5 Flash-Lite');
      return finalizeAiAnalysis(aiAnalysis, data);
    } catch (flashLiteError: unknown) {
      if (!isGeminiCapacityError(flashLiteError)) {
        console.error('Flash-Lite failed (non-capacity):', flashLiteError);
        throw new Error(
          `Failed to analyze package with AI: ${flashLiteError instanceof Error ? flashLiteError.message : 'Unknown error'}`,
        );
      }

      console.warn('⚠ Flash-Lite unavailable (rate/capacity), falling back to Groq...');

      try {
        return await analyzeWithGroq(systemPrompt, prompt, data);
      } catch (groqError: unknown) {
        console.error('Groq also failed:', groqError);
        throw new Error(
          `Failed to analyze package with AI (all providers): ${groqError instanceof Error ? groqError.message : 'Unknown error'}`,
        );
      }
    }
  }
}

/** Review graph plus the same AI analysis the package page already shows. */
export async function reviewPackage(
  data: PackageAnalysisResult,
): Promise<{ analysis: AIPackageAnalysis; toolCalls: string[] }> {
  const { runReviewGraph } = await import("./review-agent");
  return runReviewGraph(data, (facts) => synthesizePackageReview(data, facts));
}

export async function analyzePackageWithAI(
  data: PackageAnalysisResult,
): Promise<AIPackageAnalysis> {
  const { analysis } = await reviewPackage(data);
  return analysis;
}
