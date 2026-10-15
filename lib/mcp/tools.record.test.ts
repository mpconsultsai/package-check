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
    },
  })),
);

vi.mock("@/lib/db/package-searches", () => ({ recordPackageSearch }));
vi.mock("@/lib/mcp/request-context", () => ({
  currentMcpHeaders: () => new Headers({ "user-agent": "Cursor/1.4.0" }),
}));
vi.mock("@/lib/data-fetchers/security", () => ({ checkPackageSecurity }));
vi.mock("@/lib/data-fetchers/npm-registry", () => ({
  searchNpmPackages,
  fetchNpmPackageData,
}));

import { getDependencies, getSecurity, searchPackages } from "@/lib/mcp/tools";

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

  it("should record dependency names for a package lookup", async () => {
    await getDependencies("left-pad");
    const row = lastRecorded();
    (row.resultNames as string[]).should.deep.equal(["pad-component"]);
    (row.metadata as Record<string, unknown>).should.include({
      tool: "get_dependencies",
      version: "1.3.0",
    });
  });
});
