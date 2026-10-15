import { afterEach, describe, it, vi } from "vitest";
import type { Database } from "@/lib/db/client";
import { formatPackageUsageBrief, loadPackageUsageBrief } from "@/lib/db/package-usage";

describe("formatPackageUsageBrief", () => {
  it("should skip a package with no recorded interest", () => {
    const line = formatPackageUsageBrief({
      opened: 0,
      securityChecks: 0,
      reviews: 0,
      recommendations: {},
      alsoShownWith: [],
    });
    (line === null).should.equal(true);
  });

  it("should summarise opens, security checks, reviews, and packages shown alongside", () => {
    const line = formatPackageUsageBrief({
      opened: 12,
      securityChecks: 4,
      reviews: 3,
      recommendations: { recommended: 1, "use-with-caution": 2 },
      alsoShownWith: ["date-fns", "dayjs"],
    });
    line!.should.equal(
      "pkglens usage, 30d: opened 12; security checks 4; AI reviews 3 (recommended 1, use-with-caution 2). Also shown with: date-fns, dayjs",
    );
  });
});

describe("loadPackageUsageBrief", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should stay quiet when the database is unset", async () => {
    const line = await loadPackageUsageBrief("npm", "react", null);
    (line === null).should.equal(true);
  });

  it("should format the rows returned for one package", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ opened: 12, security_checks: 4, reviews: 3 }])
      .mockResolvedValueOnce([
        { recommendation: "recommended", count: 1 },
        { recommendation: "use-with-caution", count: 2 },
        { recommendation: "ignore-me", count: 9 },
      ])
      .mockResolvedValueOnce([{ name: "date-fns" }, { name: "dayjs" }]);
    const line = await loadPackageUsageBrief("npm", " React ", { execute } as unknown as Database);
    line!.should.equal(
      "pkglens usage, 30d: opened 12; security checks 4; AI reviews 3 (recommended 1, use-with-caution 2). Also shown with: date-fns, dayjs",
    );
  });

  it("should keep the caller going when the query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const execute = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const line = await loadPackageUsageBrief("npm", "react", { execute } as unknown as Database);
    (line === null).should.equal(true);
  });
});
