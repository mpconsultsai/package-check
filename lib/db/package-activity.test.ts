import { afterEach, describe, it, vi } from "vitest";
import type { Database } from "@/lib/db/client";
import { groupPackageActivity, loadPackageActivity } from "@/lib/db/package-activity";

describe("groupPackageActivity", () => {
  it("should rank by checks for popular and by time for recent", () => {
    const activity = groupPackageActivity([
      { ecosystem: "npm", name: "react", checks: 9, last_checked: "2026-10-10T10:00:00Z" },
      { ecosystem: "npm", name: "zod", checks: 2, last_checked: "2026-10-15T10:00:00Z" },
      { ecosystem: "npm", name: "@tanstack/query", checks: 5, last_checked: "2026-10-12T10:00:00Z" },
      { ecosystem: "pypi", name: "requests", checks: 3, last_checked: new Date("2026-10-11T10:00:00Z") },
    ]);
    activity.npm.popular.map((item) => item.name).should.deep.equal([
      "react",
      "@tanstack/query",
      "zod",
    ]);
    activity.npm.recent.map((item) => item.name).should.deep.equal([
      "zod",
      "@tanstack/query",
      "react",
    ]);
    activity.pypi.popular.should.deep.equal([{ name: "requests", checks: 3 }]);
    activity.nuget.should.deep.equal({ popular: [], recent: [] });
  });

  it("should drop names that do not look like packages", () => {
    const activity = groupPackageActivity([
      { ecosystem: "npm", name: "hello world", checks: 4, last_checked: "2026-10-10T10:00:00Z" },
      { ecosystem: "npm", name: "<script>", checks: 4, last_checked: "2026-10-10T10:00:00Z" },
      { ecosystem: "npm", name: "a", checks: 4, last_checked: "2026-10-10T10:00:00Z" },
      { ecosystem: "cargo", name: "serde", checks: 4, last_checked: "2026-10-10T10:00:00Z" },
      { ecosystem: "nuget", name: "Newtonsoft.Json", checks: 1, last_checked: "2026-10-10T10:00:00Z" },
      {
        ecosystem: "maven",
        name: "com.google.guava:guava",
        checks: 2,
        last_checked: "2026-10-10T10:00:00Z",
      },
    ]);
    activity.npm.popular.should.deep.equal([]);
    activity.nuget.popular.should.deep.equal([{ name: "Newtonsoft.Json", checks: 1 }]);
    activity.maven.popular.should.deep.equal([
      { name: "com.google.guava:guava", checks: 2 },
    ]);
  });
});

describe("loadPackageActivity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return empty lists when the database is unset", async () => {
    const result = await loadPackageActivity(null);
    result.activity.npm.should.deep.equal({ popular: [], recent: [] });
    result.matchedRows.should.equal(0);
    (result.error === null).should.equal(true);
  });

  it("should return empty lists when the query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const execute = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const result = await loadPackageActivity({ execute } as unknown as Database);
    result.activity.pypi.should.deep.equal({ popular: [], recent: [] });
    result.matchedRows.should.equal(0);
    result.error!.should.match(/connection refused/);
  });

  it("should group rows returned by execute", async () => {
    const execute = vi.fn(async () => [
      {
        ecosystem: "npm",
        name: "lodash",
        checks: 3,
        last_checked: "2026-11-10T10:00:00Z",
      },
    ]);
    const result = await loadPackageActivity({ execute } as unknown as Database);
    result.matchedRows.should.equal(1);
    (result.error === null).should.equal(true);
    result.activity.npm.popular.should.deep.equal([{ name: "lodash", checks: 3 }]);
  });
});
