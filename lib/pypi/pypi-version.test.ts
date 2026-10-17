import { describe, it } from "vitest";
import {
  comparePypiVersions,
  isPypiPrerelease,
  listStablePypiVersions,
  sortPypiVersionsDesc,
} from "@/lib/pypi/pypi-version";

describe("isPypiPrerelease", () => {
  it("should treat an empty version as a prerelease", () => {
    isPypiPrerelease("  ").should.be.true;
  });

  it("should treat post releases as stable", () => {
    isPypiPrerelease("1.2.0.post1").should.be.false;
  });

  it("should detect alpha, beta, rc, and compact forms", () => {
    isPypiPrerelease("1.0.0a1").should.be.true;
    isPypiPrerelease("2.0b1").should.be.true;
    isPypiPrerelease("1.0.0-rc2").should.be.true;
    isPypiPrerelease("1.0.0.dev1").should.be.true;
  });

  it("should treat a plain version as stable", () => {
    isPypiPrerelease("1.2.3").should.be.false;
  });
});

describe("comparePypiVersions", () => {
  it("should sort newer semver first when used by sortPypiVersionsDesc", () => {
    sortPypiVersionsDesc(["1.0.0", "1.10.0", "2.0.0"]).should.deep.equal([
      "2.0.0",
      "1.10.0",
      "1.0.0",
    ]);
  });

  it("should prefer a comparable version over a non-comparable one", () => {
    comparePypiVersions("1.0.0", "not-a-version").should.be.below(0);
    comparePypiVersions("not-a-version", "1.0.0").should.be.above(0);
  });
});

describe("listStablePypiVersions", () => {
  it("should be empty without a time map", () => {
    listStablePypiVersions(undefined).should.deep.equal([]);
  });

  it("should drop metadata keys and prereleases", () => {
    listStablePypiVersions({
      created: "2020-01-01",
      "1.0a1": "2020-02-01",
      "1.0.0": "2020-03-01",
      "1.1.0": "2020-04-01",
    }).should.deep.equal(["1.1.0", "1.0.0"]);
  });
});
