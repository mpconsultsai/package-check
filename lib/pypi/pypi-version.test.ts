import { describe, it } from "vitest";
import {
  comparePypiVersions,
  describePypiSpec,
  isPypiPrerelease,
  isPypiUpdateAvailable,
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

describe("isPypiUpdateAvailable", () => {
  it("should ignore an empty spec and a wildcard", () => {
    isPypiUpdateAvailable(undefined, "1.0.0").should.be.false;
    isPypiUpdateAvailable("*", "1.0.0").should.be.false;
    isPypiUpdateAvailable(">=1.0", "Unknown").should.be.false;
  });

  it("should flag a pin only when latest is newer", () => {
    isPypiUpdateAvailable("==1.26.4", "2.1.0").should.be.true;
    isPypiUpdateAvailable("==2.0.0", "1.26.4").should.be.false;
    isPypiUpdateAvailable("==1.0", "1.0.0").should.be.false;
  });

  it("should treat a range floor the way the npm paste check does", () => {
    isPypiUpdateAvailable(">=2.28.0", "2.32.3").should.be.true;
    isPypiUpdateAvailable(">=2.32.3", "2.32.3").should.be.false;
    isPypiUpdateAvailable("~=1.4.2", "1.4.5").should.be.true;
    isPypiUpdateAvailable("~=1.4.2", "1.4.2").should.be.false;
    isPypiUpdateAvailable(">=4.2,<5", "4.2.16").should.be.true;
    isPypiUpdateAvailable("==1.4.*", "1.4.2").should.be.true;
  });
});

describe("describePypiSpec", () => {
  it("should label pins, compatible releases, and ranges", () => {
    describePypiSpec("==1.26.4")!.detail.should.equal("exact 1.26.4");
    describePypiSpec("~=1.4.2")!.detail.should.equal("≥ 1.4.2");
    describePypiSpec(">= 2.28")!.detail.should.equal("≥ 2.28");
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
