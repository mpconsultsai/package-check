import { describe, it } from "vitest";
import { buildReleaseCadence, buildReleaseTypeMix } from "@/lib/packages/release-cadence";

describe("buildReleaseCadence", () => {
  it("should be empty without publish dates", () => {
    buildReleaseCadence(null).should.deep.equal([]);
    buildReleaseCadence({ created: "not-a-date" }).should.deep.equal([]);
  });

  it("should count releases in their publish month", () => {
    const points = buildReleaseCadence({
      created: "2024-01-01T00:00:00.000Z",
      "1.0.0": "2024-01-15T00:00:00.000Z",
      "1.1.0": "2024-01-20T00:00:00.000Z",
      "1.2.0": "2024-03-01T00:00:00.000Z",
    });
    points.find((point) => point.date === "2024-01-01")!.value.should.equal(2);
    points.find((point) => point.date === "2024-02-01")!.value.should.equal(0);
    points.find((point) => point.date === "2024-03-01")!.value.should.equal(1);
  });
});

describe("buildReleaseTypeMix", () => {
  it("should be empty without stable versions", () => {
    buildReleaseTypeMix(undefined).totals.all.should.equal(0);
    buildReleaseTypeMix({ "1.0.0-beta.1": "2024-01-01T00:00:00.000Z" }).totals.all
      .should.equal(0);
  });

  it("should count major, minor, and patch bumps", () => {
    const mix = buildReleaseTypeMix({
      "1.0.0": "2024-01-01T00:00:00.000Z",
      "1.1.0": "2024-02-01T00:00:00.000Z",
      "1.1.1": "2024-02-15T00:00:00.000Z",
      "2.0.0": "2024-03-01T00:00:00.000Z",
    });
    mix.totals.major.should.equal(2);
    mix.totals.minor.should.equal(1);
    mix.totals.patch.should.equal(1);
    mix.recentMajors[0].version.should.equal("2.0.0");
  });
});
