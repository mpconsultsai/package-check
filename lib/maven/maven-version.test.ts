import { describe, it } from "vitest";
import {
  compareMavenVersions,
  isMavenPrerelease,
  isMavenUpdateAvailable,
  listStableMavenVersions,
} from "@/lib/maven/maven-version";

describe("maven-version", () => {
  it("should treat SNAPSHOT and RC as prerelease", () => {
    isMavenPrerelease("1.2.3-SNAPSHOT").should.equal(true);
    isMavenPrerelease("2.0.0-rc1").should.equal(true);
    isMavenPrerelease("33.4.0-jre").should.equal(false);
    isMavenPrerelease("1.0.0").should.equal(false);
  });

  it("should order numeric versions and prefer stable over snapshot", () => {
    compareMavenVersions("2.0.0", "1.9.9").should.be.above(0);
    compareMavenVersions("1.0.0", "1.0.0-SNAPSHOT").should.be.above(0);
  });

  it("should prefer -jre over -android for the same numeric version", () => {
    compareMavenVersions("33.4.8-jre", "33.4.8-android").should.be.above(0);
    listStableMavenVersions({
      "33.4.8-android": "2025-01-01",
      "33.4.8-jre": "2025-01-01",
      "33.4.7-jre": "2024-12-01",
    }).should.deep.equal([
      "33.4.8-jre",
      "33.4.8-android",
      "33.4.7-jre",
    ]);
  });

  it("should list stable versions newest first", () => {
    listStableMavenVersions({
      "1.0.0": "2020-01-01",
      "1.1.0-SNAPSHOT": "2020-02-01",
      "2.0.0": "2021-01-01",
      created: "x",
    }).should.deep.equal(["2.0.0", "1.0.0"]);
  });

  it("should detect updates from a pinned version", () => {
    isMavenUpdateAvailable("1.0.0", "2.0.0").should.equal(true);
    isMavenUpdateAvailable("2.0.0", "2.0.0").should.equal(false);
  });
});
