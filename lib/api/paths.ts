/**
 * Canonical API paths. Prefer these over hard-coded strings in the client.
 *
 * Groups:
 * - packages - lookup & graph around a package
 * - analysis - full package report (metrics / AI)
 * - upgrade - version-range upgrade guidance
 * - watchlist / health - app utilities
 */
export const apiPaths = {
  health: "/api/v1/health",
  packages: {
    search: "/api/v1/packages/search",
    /** Three names drawn from that registry's top downloads */
    examples: "/api/v1/packages/examples",
    security: "/api/v1/packages/security",
    charts: "/api/v1/packages/charts",
    similar: "/api/v1/packages/similar",
    /** Direct + peer dependencies of the package */
    dependencies: "/api/v1/packages/dependencies",
    /** Transitive graph + advisory overlay (deps.dev) */
    dependenciesGraph: "/api/v1/packages/dependencies/graph",
    /** OpenSSF Scorecard for linked GitHub repo (deps.dev) */
    scorecard: "/api/v1/packages/scorecard",
    /** Other packages that depend on this one */
    dependents: "/api/v1/packages/dependents",
  },
  analysis: {
    /** Registry / GitHub / security metrics (no LLM) */
    metrics: "/api/v1/analysis/metrics",
    /** Metrics plus AI recommendation */
    ai: "/api/v1/analysis/ai",
  },
  upgrade: {
    /** Breaking notes + peer diff for from→to */
    details: "/api/v1/upgrade",
    /** LangGraph upgrade brief */
    agent: "/api/v1/upgrade/agent",
  },
  watchlist: {
    check: "/api/v1/watchlist/check",
  },
} as const;
