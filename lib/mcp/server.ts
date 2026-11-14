import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppError } from "@/lib/api/errors";
import {
  analysePackage,
  checkProjectFit,
  checkVersion,
  getDependencies,
  getDependencyGraph,
  getPackageReport,
  getScorecard,
  getSecurity,
  searchPackages,
  upgradePackage,
} from "@/lib/mcp/tools";
import {
  mcpClientKey,
  takeMcpAnalyseLimit,
} from "@/lib/mcp/rate-limit";
import { currentMcpHeaders } from "@/lib/mcp/request-context";

const ecosystem = z
  .enum(["npm", "pypi", "pip", "nuget", "maven"])
  .optional()
  .describe("Registry. Defaults to npm. pip is accepted as PyPI.");

/** npm package names max out around 214; keep other registries in the same bound. */
const packageName = z
  .string()
  .trim()
  .min(1)
  .max(214)
  .describe("Package name.");

const searchQuery = z
  .string()
  .trim()
  .min(2)
  .max(200)
  .describe("Search text. At least 2 characters.");

const versionString = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe("Package version.");

const jsonText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/** Expected AppError messages stay useful for agents; unexpected errors stay generic. */
const toolError = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true as const,
    };
  }
  console.error("MCP tool failed:", error);
  return {
    content: [{ type: "text" as const, text: "Request failed" }],
    isError: true as const,
  };
};

const run = async (work: () => Promise<unknown>) => {
  try {
    return jsonText(await work());
  } catch (error) {
    return toolError(error);
  }
};

const assertAnalyseAllowed = (): void => {
  const authorization = currentMcpHeaders()?.get("authorization") ?? null;
  const limited = takeMcpAnalyseLimit(mcpClientKey(authorization));
  if (!limited.ok) {
    throw new AppError(
      `analyse_package rate limit exceeded. Retry in ${limited.retryAfterSec}s.`,
      429,
    );
  }
};

export const createPkglensMcpServer = (): McpServer => {
  const server = new McpServer(
    { name: "package-check", version: "0.1.0" },
    {
      instructions:
        "Package reviews for npm, PyPI, NuGet, and Maven. Prefer get_package / check_version / get_security before analyse_package (LLM). npm-only extras: upgrade_package, get_dependency_graph, get_scorecard, check_project_fit.",
    },
  );

  server.registerTool(
    "search_packages",
    {
      description: "Search npm, PyPI, NuGet, or Maven by name.",
      inputSchema: {
        query: searchQuery,
        ecosystem,
        limit: z.number().int().min(1).max(8).optional(),
      },
    },
    async ({ query, ecosystem: registry, limit }) =>
      run(() => searchPackages(query, registry, limit)),
  );

  server.registerTool(
    "get_package",
    {
      description:
        "Registry, quality, and security counts for the latest version. Does not call an LLM.",
      inputSchema: {
        package: packageName,
        ecosystem,
      },
    },
    async ({ package: name, ecosystem: registry }) =>
      run(() => getPackageReport(name, registry)),
  );

  server.registerTool(
    "get_security",
    {
      description: "Advisories that affect one package version.",
      inputSchema: {
        package: packageName,
        version: versionString,
        ecosystem,
      },
    },
    async ({ package: name, version, ecosystem: registry }) =>
      run(() => getSecurity(name, version, registry)),
  );

  server.registerTool(
    "get_dependencies",
    {
      description:
        "Direct dependencies for the latest version. Peer dependencies are included for npm.",
      inputSchema: {
        package: packageName,
        ecosystem,
      },
    },
    async ({ package: name, ecosystem: registry }) =>
      run(() => getDependencies(name, registry)),
  );

  server.registerTool(
    "get_dependency_graph",
    {
      description:
        "npm only. Transitive dependency graph from deps.dev with advisory counts. Defaults to the latest version. Node list may be truncated.",
      inputSchema: {
        package: packageName.describe("npm package name."),
        version: versionString
          .optional()
          .describe("Version to expand. Defaults to latest."),
      },
    },
    async ({ package: name, version }) =>
      run(() => getDependencyGraph(name, version)),
  );

  server.registerTool(
    "get_scorecard",
    {
      description:
        "OpenSSF Scorecard for a GitHub project. Pass an npm package (repo resolved from the registry) and/or a repository URL or owner/repo.",
      inputSchema: {
        package: packageName
          .optional()
          .describe("npm package name used to resolve the GitHub repository."),
        repository: z
          .string()
          .trim()
          .min(3)
          .max(256)
          .optional()
          .describe("GitHub URL or owner/repo."),
      },
    },
    async ({ package: name, repository }) =>
      run(() => getScorecard({ package: name, repository })),
  );

  server.registerTool(
    "check_version",
    {
      description:
        "Verdict for one package version: use, wait, prefer_other, or avoid. Uses advisories, deprecation, and (npm) release cooldown. No LLM.",
      inputSchema: {
        package: packageName,
        version: versionString,
        ecosystem,
        cooldownHours: z
          .number()
          .int()
          .min(0)
          .max(168)
          .optional()
          .describe(
            "npm only. Hours to wait after publish before use (default 24). 0 disables.",
          ),
      },
    },
    async ({ package: name, version, ecosystem: registry, cooldownHours }) =>
      run(() => checkVersion(name, version, registry, cooldownHours)),
  );

  server.registerTool(
    "check_project_fit",
    {
      description:
        "npm only. Reverse peer check: given project dependency versions, which packages conflict with upgrading package to `to`.",
      inputSchema: {
        package: packageName.describe("npm package being upgraded."),
        to: versionString.describe("Concrete target version."),
        projectDeps: z
          .record(z.string(), z.string())
          .describe(
            "Map of project package name → installed version or range (e.g. from package.json dependencies).",
          ),
      },
    },
    async ({ package: name, to, projectDeps }) =>
      run(() => checkProjectFit({ package: name, to, projectDeps })),
  );

  server.registerTool(
    "upgrade_package",
    {
      description:
        "npm only. Compare an installed version with the latest stable release, or with a version you pass as to. Returns the bump size, how many releases are behind, and breaking notes, peer changes, and engine changes when an upgrade exists. Does not call an LLM.",
      inputSchema: {
        package: packageName.describe("npm package name."),
        from: versionString.describe("Installed version, such as 4.17.21."),
        to: versionString
          .optional()
          .describe("Target version. Defaults to the latest stable release."),
      },
    },
    async ({ package: name, from, to }) => run(() => upgradePackage(name, from, to)),
  );

  server.registerTool(
    "analyse_package",
    {
      description:
        "Package review plus an AI recommendation, strengths, and concerns. Slower than get_package because it calls the configured LLM.",
      inputSchema: {
        package: packageName,
        ecosystem,
      },
    },
    async ({ package: name, ecosystem: registry }) =>
      run(async () => {
        assertAnalyseAllowed();
        return analysePackage(name, registry);
      }),
  );

  return server;
};
