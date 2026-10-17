import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AIPackageAnalysis } from "@/lib/ai/analyzer";
import { fetchTransitiveDependencyGraph } from "@/lib/data-fetchers/deps-dev";
import {
  fetchOpenSSFScorecard,
  resolveGithubProjectId,
  type OpenSSFScorecard,
} from "@/lib/data-fetchers/openssf-scorecard";
import { featuresForEcosystem } from "@/lib/packages/ecosystem-features";
import { listPackageDependencies } from "@/lib/packages/package-deps";
import type { PackageAnalysisResult } from "@/lib/types/package-data";

const ADVISORY_CAP = 8;
const DEPENDENCY_CAP = 20;
const TRANSITIVE_NAME_CAP = 8;

export type ReviewRoute = {
  advisories: boolean;
  dependencies: boolean;
  scorecard: boolean;
  transitive: boolean;
};

export type ReviewFacts = {
  advisoryLines: string[];
  dependencyLines: string[];
  scorecard: OpenSSFScorecard | null;
};

type ReviewSynthesize = (facts: ReviewFacts) => Promise<AIPackageAnalysis>;

const ReviewState = Annotation.Root({
  data: Annotation<PackageAnalysisResult>,
  advisoryLines: Annotation<string[]>,
  dependencyLines: Annotation<string[]>,
  scorecard: Annotation<OpenSSFScorecard | null>,
  toolCalls: Annotation<string[]>,
  analysis: Annotation<AIPackageAnalysis | null>,
});

function appendToolCall(state: { toolCalls?: string[] }, name: string): string[] {
  return [...(state.toolCalls ?? []), name];
}

/** Which enrichment stations a package needs. Scorecard and the transitive tree are npm-only. */
export function reviewRoute(data: PackageAnalysisResult): ReviewRoute {
  const ecosystem = data.ecosystem ?? "npm";
  const features = featuresForEcosystem(ecosystem);
  const dependencyCount = listPackageDependencies(
    data.npm?.dependencies,
    data.npm?.peerDependencies,
  ).length;
  const dependencies = dependencyCount > 0;
  return {
    advisories: (data.security?.totalCount ?? 0) > 0,
    dependencies,
    scorecard:
      ecosystem === "npm" &&
      resolveGithubProjectId(data.npm?.repository?.url) !== null,
    transitive: features.transitiveDepsTree && dependencies,
  };
}

function advisoryLines(data: PackageAnalysisResult): string[] {
  return (data.security?.vulnerabilities ?? []).slice(0, ADVISORY_CAP).map((item) => {
    const id = item.cveId?.trim() || item.id;
    const range = item.vulnerableVersionRange?.trim();
    const title = item.title.trim().slice(0, 140);
    return range
      ? `${item.severity} ${id}: ${title} (${range})`
      : `${item.severity} ${id}: ${title}`;
  });
}

function dependencyLines(data: PackageAnalysisResult): string[] {
  const dependencies = listPackageDependencies(
    data.npm?.dependencies,
    data.npm?.peerDependencies,
  );
  return dependencies.slice(0, DEPENDENCY_CAP).map((dep) => {
    const marker = dep.marker ? ` [${dep.marker}]` : "";
    return `${dep.name} ${dep.range} (${dep.kind})${marker}`;
  });
}

function transitiveLine(
  stats: { total: number; withAdvisories: number },
  names: string[],
): string {
  const listed = names.slice(0, TRANSITIVE_NAME_CAP).join(", ");
  const base = `Transitive: ${stats.total} packages, ${stats.withAdvisories} with advisories`;
  return listed ? `${base}: ${listed}` : base;
}

async function collect(state: typeof ReviewState.State) {
  return { toolCalls: appendToolCall(state, "collect") };
}

async function enrichAdvisories(state: typeof ReviewState.State) {
  if (!reviewRoute(state.data).advisories) {
    return { toolCalls: appendToolCall(state, "enrich_advisories:skip") };
  }
  const lines = advisoryLines(state.data);
  return {
    advisoryLines: lines,
    toolCalls: appendToolCall(state, `enrich_advisories:${lines.length}`),
  };
}

async function enrichDependencies(state: typeof ReviewState.State) {
  const route = reviewRoute(state.data);
  if (!route.dependencies) {
    return { toolCalls: appendToolCall(state, "enrich_dependencies:skip") };
  }
  const total = listPackageDependencies(
    state.data.npm?.dependencies,
    state.data.npm?.peerDependencies,
  ).length;
  const lines = dependencyLines(state.data);
  const calls = [`enrich_dependencies:${total}`];
  if (route.transitive) {
    const version = state.data.npm?.version?.trim();
    if (!version) {
      calls.push("enrich_transitive:skip");
    } else {
      try {
        const graph = await fetchTransitiveDependencyGraph(
          state.data.packageName,
          version,
        );
        const names = graph.nodes
          .filter((node) => node.relation !== "SELF" && node.advisoryCount > 0)
          .map((node) => `${node.name}@${node.version}`);
        lines.push(transitiveLine(graph.stats, names));
        calls.push(`enrich_transitive:${graph.stats.withAdvisories}`);
      } catch {
        calls.push("enrich_transitive:skip");
      }
    }
  }
  return {
    dependencyLines: lines,
    toolCalls: [...(state.toolCalls ?? []), ...calls],
  };
}

async function enrichScorecard(state: typeof ReviewState.State) {
  if (!reviewRoute(state.data).scorecard) {
    return { toolCalls: appendToolCall(state, "enrich_scorecard:skip") };
  }
  const projectId = resolveGithubProjectId(state.data.npm?.repository?.url);
  if (!projectId) {
    return { toolCalls: appendToolCall(state, "enrich_scorecard:skip") };
  }
  try {
    const scorecard = await fetchOpenSSFScorecard(projectId);
    return {
      scorecard,
      toolCalls: appendToolCall(state, "enrich_scorecard"),
    };
  } catch {
    return { toolCalls: appendToolCall(state, "enrich_scorecard:skip") };
  }
}

function buildReviewGraph(synthesize: ReviewSynthesize) {
  return new StateGraph(ReviewState)
    .addNode("collect", collect)
    .addNode("advisories", enrichAdvisories)
    .addNode("dependencies", enrichDependencies)
    .addNode("enrichScorecard", enrichScorecard)
    .addNode("synthesize", async (state) => {
      const analysis = await synthesize({
        advisoryLines: state.advisoryLines ?? [],
        dependencyLines: state.dependencyLines ?? [],
        scorecard: state.scorecard ?? null,
      });
      return {
        analysis,
        toolCalls: appendToolCall(state, "synthesize"),
      };
    })
    .addEdge(START, "collect")
    .addEdge("collect", "advisories")
    .addEdge("advisories", "dependencies")
    .addEdge("dependencies", "enrichScorecard")
    .addEdge("enrichScorecard", "synthesize")
    .addEdge("synthesize", END)
    .compile();
}

/** Run the review graph. Synthesize is injected so tests can stop before the LLM. */
export async function runReviewGraph(
  data: PackageAnalysisResult,
  synthesize: ReviewSynthesize,
): Promise<{ analysis: AIPackageAnalysis; toolCalls: string[] }> {
  const graph = buildReviewGraph(synthesize);
  const result = await graph.invoke({
    data,
    advisoryLines: [],
    dependencyLines: [],
    scorecard: null,
    toolCalls: [],
    analysis: null,
  });
  if (!result.analysis) {
    throw new Error("Review graph did not produce an analysis");
  }
  return {
    analysis: result.analysis,
    toolCalls: result.toolCalls ?? [],
  };
}
