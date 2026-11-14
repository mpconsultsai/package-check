import { beforeEach, describe, it, vi } from "vitest";

const recordPackageSearch = vi.hoisted(() => vi.fn(async () => {}));
const searchNpmPackages = vi.hoisted(() =>
  vi.fn(async () => [
    { name: "left-pad", version: "1.3.0", description: "pad" },
  ]),
);
const checkPackageSecurity = vi.hoisted(() =>
  vi.fn(async () => ({
    totalCount: 2,
    critical: 0,
    high: 1,
    moderate: 1,
    low: 0,
    vulnerabilities: [],
  })),
);
const fetchNpmPackageData = vi.hoisted(() =>
  vi.fn(async () => ({
    data: {
      name: "left-pad",
      version: "1.3.0",
      dependencies: { "pad-component": "^1.0.0" },
      peerDependencies: {},
      repository: { url: "https://github.com/lodash/lodash" },
      time: { "1.3.0": "2020-01-01T00:00:00.000Z" },
    },
  })),
);
const axiosGet = vi.hoisted(() =>
  vi.fn(async () => ({ status: 200, data: {} })),
);

vi.mock("@/lib/db/package-searches", () => ({ recordPackageSearch }));
vi.mock("@/lib/mcp/request-context", () => ({
  currentMcpHeaders: () => new Headers({ "user-agent": "Cursor/1.4.0" }),
}));
vi.mock("@/lib/data-fetchers/security", () => ({ checkPackageSecurity }));
vi.mock("axios", () => ({ default: { get: axiosGet } }));
const fetchOpenSSFScorecard = vi.hoisted(() =>
  vi.fn(async () => ({
    projectId: "github.com/lodash/lodash",
    overallScore: 6.5,
    scoredAt: "2026-01-01",
    checks: [{ name: "Maintained", score: 10, reason: "ok" }],
    scorecardViewerUrl: "https://scorecard.dev",
    depsDevProjectUrl: "https://deps.dev",
  })),
);
const resolveGithubProjectId = vi.hoisted(() =>
  vi.fn(() => "github.com/lodash/lodash"),
);
const fetchTransitiveDependencyGraph = vi.hoisted(() =>
  vi.fn(async () => ({
    packageName: "left-pad",
    version: "1.3.0",
    nodes: [
      {
        name: "left-pad",
        version: "1.3.0",
        relation: "SELF",
        advisoryCount: 0,
        advisoryIds: [],
      },
    ],
    edges: [],
    stats: { total: 1, direct: 0, indirect: 0, withAdvisories: 0 },
    depsDevUrl: "https://deps.dev/npm/left-pad/1.3.0",
  })),
);
const versionCheckVerdict = vi.hoisted(() =>
  vi.fn(() => ({
    verdict: "use",
    recommendedVersion: null,
    headline: "Use 1.3.0",
    reasons: [],
  })),
);
const loadReversePeerFits = vi.hoisted(() =>
  vi.fn(async () => ({
    fits: [
      {
        name: "@typescript-eslint/parser",
        at: "8.0.0",
        required: "^5.0.0",
        target: "5.6.0",
        status: "satisfies",
      },
    ],
    scanned: 1,
    truncated: false,
  })),
);
const fetchNpmDepsDevVersionInsight = vi.hoisted(() =>
  vi.fn(async () => ({ saferVersion: null })),
);

vi.mock("@/lib/data-fetchers/npm-registry", () => ({
  searchNpmPackages,
  fetchNpmPackageData,
}));
vi.mock("@/lib/data-fetchers/openssf-scorecard", () => ({
  fetchOpenSSFScorecard,
  resolveGithubProjectId,
}));
vi.mock("@/lib/data-fetchers/deps-dev", () => ({
  fetchTransitiveDependencyGraph,
  fetchNpmDepsDevVersionInsight,
}));
vi.mock("@/lib/packages/version-check", () => ({ versionCheckVerdict }));
vi.mock("@/lib/upgrade/project-reverse-peer-fit", () => ({
  loadReversePeerFits,
}));

import {
  checkProjectFit,
  checkVersion,
  getDependencies,
  getDependencyGraph,
  getScorecard,
  getSecurity,
  searchPackages,
  upgradePackage,
} from "@/lib/mcp/tools";

function lastRecorded() {
  const call = recordPackageSearch.mock.calls.at(-1) as
    | [Record<string, unknown>]
    | undefined;
  call!.should.be.ok;
  return call![0];
}

describe("MCP tool recording", () => {
  beforeEach(() => {
    recordPackageSearch.mockClear();
  });

  it("should record a package search with the tool name and agent", async () => {
    await searchPackages("left");
    const row = lastRecorded();
    row.should.include({ ecosystem: "npm", query: "left", source: "mcp" });
    (row.resultNames as string[]).should.deep.equal(["left-pad"]);
    (row.metadata as Record<string, unknown>).should.include({
      tool: "search_packages",
      agent: "Cursor",
      limit: 8,
    });
  });

  it("should record a security check with the version and advisory count", async () => {
    await getSecurity("left-pad", " 1.3.0 ");
    const row = lastRecorded();
    row.should.include({
      ecosystem: "npm",
      query: "left-pad",
      source: "mcp",
    });
    (row.metadata as Record<string, unknown>).should.include({
      tool: "get_security",
      version: "1.3.0",
      advisoryCount: 2,
      agent: "Cursor",
    });
  });

  it("should record an npm upgrade that is already current", async () => {
    const result = await upgradePackage("left-pad", "1.3.0");
    result.verdict.should.equal("current");
    result.latest.should.equal("1.3.0");
    (result.changes === null).should.equal(true);
    const row = lastRecorded();
    row.should.include({ ecosystem: "npm", query: "left-pad", source: "mcp" });
    (row.metadata as Record<string, unknown>).should.include({
      tool: "upgrade_package",
      from: "1.3.0",
      to: "1.3.0",
      verdict: "current",
    });
  });

  it("should record dependency names for a package lookup", async () => {
    await getDependencies("left-pad");
    const row = lastRecorded();
    (row.resultNames as string[]).should.deep.equal(["pad-component"]);
    (row.metadata as Record<string, unknown>).should.include({
      tool: "get_dependencies",
      version: "1.3.0",
    });
  });

  it("should record a scorecard lookup", async () => {
    const result = await getScorecard({ package: "left-pad" });
    result.overallScore!.should.equal(6.5);
    const row = lastRecorded();
    (row.metadata as Record<string, unknown>).should.include({
      tool: "get_scorecard",
      projectId: "github.com/lodash/lodash",
    });
  });

  it("should record a dependency graph lookup", async () => {
    const result = await getDependencyGraph("left-pad");
    result.stats.total.should.equal(1);
    const row = lastRecorded();
    (row.metadata as Record<string, unknown>).should.include({
      tool: "get_dependency_graph",
      version: "1.3.0",
    });
  });

  it("should record a version check verdict", async () => {
    const result = await checkVersion("left-pad", "1.3.0");
    result.verdict.should.equal("use");
    const row = lastRecorded();
    (row.metadata as Record<string, unknown>).should.include({
      tool: "check_version",
      version: "1.3.0",
      verdict: "use",
    });
  });

  it("should record a project peer-fit scan", async () => {
    const result = await checkProjectFit({
      package: "typescript",
      to: "5.6.0",
      projectDeps: { "@typescript-eslint/parser": "8.0.0" },
    });
    result.conflicts.should.have.length(0);
    const row = lastRecorded();
    (row.metadata as Record<string, unknown>).should.include({
      tool: "check_project_fit",
      to: "5.6.0",
      scanned: 1,
    });
  });
});
