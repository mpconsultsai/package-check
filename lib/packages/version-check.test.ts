import { describe, it } from "vitest";
import {
  previousStableOutsideCooldown,
  versionCheckVerdict,
} from "@/lib/packages/version-check";

const now = new Date("2026-10-27T12:00:00.000Z").getTime();

describe("previousStableOutsideCooldown", () => {
  it("should return the newest older stable outside the cooldown window", () => {
    const prior = previousStableOutsideCooldown({
      selectedVersion: "2.0.0",
      cooldownHours: 24,
      now,
      versionTimes: {
        "2.0.0": "2026-10-27T10:00:00.000Z",
        "1.1.0": "2026-10-26T10:00:00.000Z",
        "1.0.0": "2026-10-20T10:00:00.000Z",
      },
    });
    (prior ?? "").should.equal("1.1.0");
  });

  it("should return null when cooldown is off", () => {
    const prior = previousStableOutsideCooldown({
      selectedVersion: "2.0.0",
      cooldownHours: 0,
      now,
      versionTimes: {
        "2.0.0": "2026-10-27T10:00:00.000Z",
        "1.0.0": "2026-10-01T10:00:00.000Z",
      },
    });
    (prior === null).should.equal(true);
  });
});

describe("versionCheckVerdict", () => {
  it("should recommend use when the version is clear", () => {
    const result = versionCheckVerdict({
      selectedVersion: "1.2.3",
      security: { totalCount: 0, critical: 0, high: 0 },
      publishedAt: "2026-01-01T00:00:00.000Z",
      cooldownHours: 24,
      now,
    });
    result.verdict.should.equal("use");
    result.headline.should.equal("Use 1.2.3");
    (result.recommendedVersion === null).should.equal(true);
  });

  it("should avoid a deprecated version", () => {
    const result = versionCheckVerdict({
      selectedVersion: "1.0.0",
      security: { totalCount: 0, critical: 0, high: 0 },
      deprecated: "Use 2.x instead",
      saferVersion: "2.0.0",
      now,
    });
    result.verdict.should.equal("avoid");
    result.recommendedVersion!.should.equal("2.0.0");
    result.headline.should.match(/Avoid 1\.0\.0/);
  });

  it("should avoid critical advisories with no clearer release", () => {
    const result = versionCheckVerdict({
      selectedVersion: "1.0.0",
      security: { totalCount: 1, critical: 1, high: 0 },
      now,
    });
    result.verdict.should.equal("avoid");
    (result.recommendedVersion === null).should.equal(true);
  });

  it("should prefer a clearer release when advisories exist", () => {
    const result = versionCheckVerdict({
      selectedVersion: "4.17.20",
      security: { totalCount: 2, critical: 0, high: 0, moderate: 2 },
      saferVersion: "4.18.1",
      now,
    });
    result.verdict.should.equal("prefer_other");
    result.recommendedVersion!.should.equal("4.18.1");
    result.headline.should.equal("Prefer 4.18.1 over 4.17.20");
  });

  it("should avoid severe advisories even when a clearer release exists", () => {
    const result = versionCheckVerdict({
      selectedVersion: "4.17.20",
      security: { totalCount: 2, critical: 0, high: 2 },
      saferVersion: "4.18.1",
      now,
    });
    result.verdict.should.equal("avoid");
    result.recommendedVersion!.should.equal("4.18.1");
  });

  it("should wait when the publish is inside the cooldown", () => {
    const result = versionCheckVerdict({
      selectedVersion: "2.0.0",
      security: { totalCount: 0, critical: 0, high: 0 },
      publishedAt: "2026-10-27T10:00:00.000Z",
      cooldownHours: 24,
      versionTimes: {
        "2.0.0": "2026-10-27T10:00:00.000Z",
        "1.0.0": "2026-10-01T10:00:00.000Z",
      },
      now,
    });
    result.verdict.should.equal("wait");
    result.recommendedVersion!.should.equal("1.0.0");
    result.headline.should.match(/Wait on 2\.0\.0/);
  });
});
