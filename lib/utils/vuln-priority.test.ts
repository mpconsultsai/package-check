import { describe, it } from "vitest";
import { formatEpssPercent, sortByThreatPriority } from "@/lib/utils/vuln-priority";

describe("sortByThreatPriority", () => {
  it("should put known exploited issues first, then severity, then EPSS", () => {
    sortByThreatPriority([
      { id: "low-epss", severity: "high", epssScore: 0.1 },
      { id: "kev", severity: "low", knownExploited: true },
      { id: "high-epss", severity: "high", epssScore: 0.9 },
      { id: "critical", severity: "critical" },
    ]).map((item) => item.id).should.deep.equal([
      "kev",
      "critical",
      "high-epss",
      "low-epss",
    ]);
  });
});

describe("formatEpssPercent", () => {
  it("should be null for a missing score", () => {
    (formatEpssPercent(null) === null).should.be.true;
    (formatEpssPercent(Number.NaN) === null).should.be.true;
  });

  it("should format larger scores with fewer decimals", () => {
    formatEpssPercent(0.2)!.should.equal("20.0%");
    formatEpssPercent(0.02)!.should.equal("2.00%");
    formatEpssPercent(0.0002)!.should.equal("0.020%");
    formatEpssPercent(0.00001)!.should.equal("<0.01%");
  });
});
