import { describe, it } from "vitest";
import { compareScorecardChecks } from "@/lib/data-fetchers/openssf-scorecard";

describe("compareScorecardChecks", () => {
  it("should put higher scores first and unset checks last", () => {
    const checks = [
      { name: "Fuzzing", score: 0, reason: "" },
      { name: "Branch-Protection", score: -1, reason: "" },
      { name: "Maintained", score: 10, reason: "" },
      { name: "License", score: 10, reason: "" },
    ];
    checks
      .sort(compareScorecardChecks)
      .map((check) => check.name)
      .should.deep.equal([
        "License",
        "Maintained",
        "Fuzzing",
        "Branch-Protection",
      ]);
  });
});
