import { describe, it } from "vitest";
import {
  compareNugetVersions,
  formatNugetVersionRange,
  isNugetPrerelease,
  isNugetUpdateAvailable,
  listStableNugetVersions,
} from "@/lib/nuget/nuget-version";

describe("isNugetPrerelease", () => {
  it("should be true when the version contains a hyphen", () => {
    isNugetPrerelease("13.0.3-beta").should.be.true;
  });

  it("should be false for a stable version", () => {
    isNugetPrerelease("13.0.3").should.be.false;
  });
});

describe("compareNugetVersions", () => {
  it("should order numeric cores", () => {
    compareNugetVersions("1.2.0", "1.10.0").should.be.below(0);
    compareNugetVersions("2.0", "1.9.9").should.be.above(0);
  });

  it("should place a stable release above a prerelease of the same numbers", () => {
    compareNugetVersions("1.0.0", "1.0.0-beta").should.be.above(0);
    compareNugetVersions("1.0.0-beta", "1.0.0").should.be.below(0);
  });

  it("should fall back to locale order for two prereleases", () => {
    compareNugetVersions("1.0.0-alpha", "1.0.0-beta").should.be.below(0);
  });
});

describe("listStableNugetVersions", () => {
  it("should be empty when there is no time map", () => {
    listStableNugetVersions(null).should.deep.equal([]);
  });

  it("should drop metadata keys and prereleases, newest first", () => {
    listStableNugetVersions({
      created: "2020-01-01",
      modified: "2024-01-01",
      unpublished: "2024-01-01",
      "1.0.0-beta": "2021-01-01",
      "1.0.0": "2021-06-01",
      "1.2.0": "2022-01-01",
    }).should.deep.equal(["1.2.0", "1.0.0"]);
  });
});

describe("isNugetUpdateAvailable", () => {
  it("should be false when the request or latest release is missing", () => {
    isNugetUpdateAvailable(undefined, "13.0.3").should.be.false;
    isNugetUpdateAvailable("12.0.0", "Unknown").should.be.false;
    isNugetUpdateAvailable("*", "13.0.3").should.be.false;
    isNugetUpdateAvailable("latest", "13.0.3").should.be.false;
  });

  it("should be true when the pinned version is older than latest", () => {
    isNugetUpdateAvailable("[12.0.1, 13.0.0)", "13.0.3").should.be.true;
  });

  it("should be false when the pin is already current", () => {
    isNugetUpdateAvailable("13.0.3", "13.0.3").should.be.false;
  });
});

describe("formatNugetVersionRange", () => {
  it("should keep a bare version and exact bracket pin", () => {
    formatNugetVersionRange("13.0.3").should.equal("13.0.3");
    formatNugetVersionRange("[13.0.3]").should.equal("13.0.3");
  });

  it("should turn a minimum-only bracket range into ≥", () => {
    formatNugetVersionRange("[1.0.0, )").should.equal("≥ 1.0.0");
    formatNugetVersionRange("[1.0.0,)").should.equal("≥ 1.0.0");
    formatNugetVersionRange("(1.0.0,)").should.equal("> 1.0.0");
  });

  it("should keep both bounds when present", () => {
    formatNugetVersionRange("[1.0.0, 2.0.0)").should.equal("≥ 1.0.0 · < 2.0.0");
    formatNugetVersionRange("(, 2.0.0]").should.equal("≤ 2.0.0");
  });

  it("should treat empty and star as any", () => {
    formatNugetVersionRange(undefined).should.equal("*");
    formatNugetVersionRange("*").should.equal("*");
  });
});

