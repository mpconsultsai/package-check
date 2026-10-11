import { afterEach, describe, it, vi } from "vitest";
import type { Database } from "@/lib/db/client";
import { recordPackageSearch } from "@/lib/db/package-searches";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureDb() {
  const rows: unknown[] = [];
  const db = {
    insert: () => ({
      values: async (row: unknown) => {
        rows.push(row);
      },
    }),
  } as unknown as Database;
  return { db, rows };
}

describe("recordPackageSearch", () => {
  it("should skip a query that is too short", async () => {
    const { db, rows } = captureDb();
    await recordPackageSearch(
      {
        ecosystem: "npm",
        query: " a ",
        resultNames: ["react"],
        source: "web",
      },
      db,
    );
    rows.should.have.length(0);
  });

  it("should insert the search with trimmed names and metadata", async () => {
    const { db, rows } = captureDb();
    await recordPackageSearch(
      {
        ecosystem: "pypi",
        query: "  requests  ",
        resultNames: [" requests ", "", "urllib3"],
        source: "mcp",
        metadata: { limit: 8, cacheHit: false },
      },
      db,
    );
    rows.should.deep.equal([
      {
        ecosystem: "pypi",
        query: "requests",
        resultCount: 2,
        resultNames: ["requests", "urllib3"],
        source: "mcp",
        metadata: { limit: 8, cacheHit: false },
      },
    ]);
  });

  it("should keep the caller going when the insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      insert: () => ({
        values: async () => {
          throw new Error("connection refused");
        },
      }),
    } as unknown as Database;
    await recordPackageSearch(
      {
        ecosystem: "npm",
        query: "react-dom",
        resultNames: ["react-dom"],
        source: "web",
      },
      db,
    );
  });
});
