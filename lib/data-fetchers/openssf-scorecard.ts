import {
  encodeDepsDevProjectId,
  githubProjectIdFromUrl,
} from "@/lib/utils/github-repository";

const DEPS_DEV_API = "https://api.deps.dev/v3";
const CACHE_MS = 6 * 60 * 60 * 1000;

export type ScorecardCheck = {
  name: string;
  score: number;
  reason: string;
  documentationUrl?: string;
};

export type OpenSSFScorecard = {
  projectId: string;
  overallScore: number | null;
  scoredAt: string | null;
  checks: ScorecardCheck[];
  scorecardViewerUrl: string;
  depsDevProjectUrl: string;
};

type DepsDevScorecardPayload = {
  scorecard?: {
    date?: string;
    overallScore?: number;
    checks?: {
      name?: string;
      score?: number;
      reason?: string;
      documentation?: { url?: string };
    }[];
  };
};

const cache = new Map<string, { expires: number; data: OpenSSFScorecard }>();

/** Highest scores first. Unset checks (negative) stay at the end. */
export function compareScorecardChecks(
  a: ScorecardCheck,
  b: ScorecardCheck,
): number {
  const rank = (score: number) => (score < 0 ? -1 : score);
  const delta = rank(b.score) - rank(a.score);
  if (delta !== 0) return delta;
  return a.name.localeCompare(b.name);
}

export function resolveGithubProjectId(
  repositoryUrl: string | null | undefined,
): string | null {
  if (!repositoryUrl?.trim()) return null;
  return githubProjectIdFromUrl(repositoryUrl);
}

export async function fetchOpenSSFScorecard(
  projectId: string,
): Promise<OpenSSFScorecard> {
  const cached = cache.get(projectId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const encoded = encodeDepsDevProjectId(projectId);
  const response = await fetch(`${DEPS_DEV_API}/projects/${encoded}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Scorecard unavailable (${response.status})`);
  }

  const payload = (await response.json()) as DepsDevScorecardPayload;
  const raw = payload.scorecard;
  if (!raw?.checks?.length) {
    throw new Error("No OpenSSF Scorecard data for this repository");
  }

  const checks: ScorecardCheck[] = raw.checks
    .filter((c) => c.name && typeof c.score === "number")
    .map((c) => ({
      name: c.name!,
      score: c.score!,
      reason: (c.reason ?? "").trim(),
      documentationUrl: c.documentation?.url?.trim() || undefined,
    }))
    .sort(compareScorecardChecks);

  const result: OpenSSFScorecard = {
    projectId,
    overallScore:
      typeof raw.overallScore === "number" ? raw.overallScore : null,
    scoredAt: raw.date ?? null,
    checks,
    scorecardViewerUrl: `https://scorecard.dev/viewer/#/${projectId}`,
    depsDevProjectUrl: `https://deps.dev/projects/${encoded}`,
  };

  cache.set(projectId, { expires: Date.now() + CACHE_MS, data: result });
  return result;
}
