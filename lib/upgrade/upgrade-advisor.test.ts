import { describe, it } from "vitest";
import {
  buildUpgradeAdvice,
  defaultFromVersion,
  listStableVersions,
} from "@/lib/upgrade/upgrade-advisor";

describe("listStableVersions", () => {
  it("should be empty without a time map", () => {
    listStableVersions(null).should.deep.equal([]);
  });

  it("should drop metadata keys and prereleases, newest first", () => {
    listStableVersions({
      created: "2020-01-01",
      "1.0.0-beta.1": "2021-01-01",
      "1.0.0": "2021-02-01",
      "2.0.0": "2022-01-01",
    }).should.deep.equal(["2.0.0", "1.0.0"]);
  });
});

describe("buildUpgradeAdvice", () => {
  const times = {
    "1.0.0": "2020-01-01T00:00:00.000Z",
    "1.2.0": "2021-01-01T00:00:00.000Z",
    "1.2.3": "2021-06-01T00:00:00.000Z",
    "2.0.0": "2022-01-01T00:00:00.000Z",
    "4.0.0": "2024-01-01T00:00:00.000Z",
  };

  it("should reject a version that is not semver", () => {
    buildUpgradeAdvice({ from: "latest", to: "1.0.0" }).verdict.should.equal(
      "invalid",
    );
  });

  it("should say the package is current when the versions match", () => {
    const advice = buildUpgradeAdvice({
      from: "1.2.3",
      to: "1.2.3",
      versionTimes: times,
    });
    advice.verdict.should.equal("current");
    advice.headline.should.match(/latest release/);
  });

  it("should reject a pin newer than latest", () => {
    buildUpgradeAdvice({ from: "2.0.0", to: "1.0.0" }).headline.should.match(
      /newer than latest/,
    );
  });

  it("should describe patch, minor, and major jumps", () => {
    buildUpgradeAdvice({
      from: "1.2.0",
      to: "1.2.3",
      versionTimes: times,
    }).verdict.should.equal("patch");
    buildUpgradeAdvice({
      from: "1.0.0",
      to: "1.2.3",
      versionTimes: times,
    }).verdict.should.equal("minor");
    const major = buildUpgradeAdvice({
      from: "1.0.0",
      to: "4.0.0",
      versionTimes: times,
    });
    major.verdict.should.equal("major");
    major.majorsCrossed.should.equal(3);
    major.intermediateMajors.should.include("2.0.0");
    major.daysBetween!.should.be.above(0);
  });
});

describe("defaultFromVersion", () => {
  it("should be empty when there are no versions", () => {
    defaultFromVersion("1.0.0", []).should.equal("");
  });

  it("should pick the newest release of the previous major", () => {
    defaultFromVersion("2.0.0", ["2.0.0", "1.0.0"]).should.equal("1.0.0");
    defaultFromVersion("9.0.0", ["2.0.0", "1.0.0"]).should.equal("2.0.0");
    defaultFromVersion("5.1.0", ["5.1.0", "5.0.0", "4.21.2", "4.0.0"]).should.equal(
      "4.21.2",
    );
  });
});
