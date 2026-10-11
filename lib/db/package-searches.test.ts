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

  it("should log the database error when the insert fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    const failure = new Error("Failed query");
    failure.cause = cause;
    const db = {
      insert: () => ({
        values: async () => {
          throw failure;
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
    errorSpy.mock.calls.should.have.length(1);
    const [label, detail] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    label.should.equal("Failed to record package search:");
    detail.should.include({ message: "connection refused", code: "ECONNREFUSED" });
    detail.should.have.property("host");
    detail.should.not.have.property("password");
  });

  it("should skip logging when the database rejects the password", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    const failure = new Error("Failed query");
    failure.cause = cause;
    const db = {
      insert: () => ({
        values: async () => {
          throw failure;
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
    errorSpy.mock.calls.should.have.length(0);
  });

  it("should log when the database client is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordPackageSearch(
      {
        ecosystem: "npm",
        query: "react-dom",
        resultNames: ["react-dom"],
        source: "web",
      },
      null,
    );
    errorSpy.mock.calls.should.have.length(1);
    errorSpy.mock.calls[0][0].should.equal(
      "Package search not recorded: database client unavailable",
    );
  });
});
