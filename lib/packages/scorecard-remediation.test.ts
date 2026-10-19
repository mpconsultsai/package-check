import { describe, it } from "vitest";
import { scorecardImprovement } from "@/lib/packages/scorecard-remediation";

describe("scorecardImprovement", () => {
  it("should name a concrete step for a low score", () => {
    scorecardImprovement("Fuzzing").should.match(/OSS-Fuzz/);
    scorecardImprovement("CII-Best-Practices").should.match(/Best Practices/);
  });

  it("should point unknown checks at the OpenSSF documentation", () => {
    scorecardImprovement("Future-Check").should.match(/OpenSSF/);
  });
});
