import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  analysePackage,
  getDependencies,
  getPackageReport,
  getSecurity,
  searchPackages,
  upgradePackage,
} from "@/lib/mcp/tools";

const ecosystem = z
  .enum(["npm", "pypi", "pip", "nuget"])
  .optional()
  .describe("Registry. Defaults to npm. pip is accepted as PyPI.");

function jsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function run(work: () => Promise<unknown>) {
  try {
    return jsonText(await work());
  } catch (error) {
    return toolError(error);
  }
}

export function createPkglensMcpServer(): McpServer {
  const server = new McpServer(
    { name: "package-check", version: "0.1.0" },
    {
      instructions:
        "Package reviews for npm, PyPI, and NuGet. get_package returns registry, quality, and advisory counts without an LLM. upgrade_package compares an installed npm version with a newer one. analyse_package adds an AI recommendation and is slower.",
    },
  );

  server.registerTool(
    "search_packages",
    {
      description: "Search npm, PyPI, or NuGet by name.",
      inputSchema: {
        query: z.string().describe("Search text. At least 2 characters."),
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
        package: z.string().describe("Package name."),
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
        package: z.string().describe("Package name."),
        version: z.string().describe("Version to check."),
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
        package: z.string().describe("Package name."),
        ecosystem,
      },
    },
    async ({ package: name, ecosystem: registry }) =>
      run(() => getDependencies(name, registry)),
  );

  server.registerTool(
    "upgrade_package",
    {
      description:
        "npm only. Compare an installed version with the latest stable release, or with a version you pass as to. Returns the bump size, how many releases are behind, and breaking notes, peer changes, and engine changes when an upgrade exists. Does not call an LLM.",
      inputSchema: {
        package: z.string().describe("npm package name."),
        from: z.string().describe("Installed version, such as 4.17.21."),
        to: z
          .string()
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
        package: z.string().describe("Package name."),
        ecosystem,
      },
    },
    async ({ package: name, ecosystem: registry }) =>
      run(() => analysePackage(name, registry)),
  );

  return server;
}
