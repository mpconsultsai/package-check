import { describe, it } from "vitest";
import {
  DEFAULT_NPM_RELEASE_COOLDOWN_HOURS,
  clampNpmReleaseCooldownHours,
  npmReleaseCooldownLabel,
} from "@/lib/prefs/npm-release-cooldown-pref";

describe("clampNpmReleaseCooldownHours", () => {
  it("should keep allowed presets", () => {
    clampNpmReleaseCooldownHours(0).should.equal(0);
    clampNpmReleaseCooldownHours(24).should.equal(24);
    clampNpmReleaseCooldownHours("48").should.equal(48);
    clampNpmReleaseCooldownHours(168).should.equal(168);
  });

  it("should default invalid values and snap to the nearest preset", () => {
    clampNpmReleaseCooldownHours(null).should.equal(
      DEFAULT_NPM_RELEASE_COOLDOWN_HOURS,
    );
    clampNpmReleaseCooldownHours("nope").should.equal(
      DEFAULT_NPM_RELEASE_COOLDOWN_HOURS,
    );
    clampNpmReleaseCooldownHours(11).should.equal(12);
    clampNpmReleaseCooldownHours(200).should.equal(168);
    clampNpmReleaseCooldownHours(-3).should.equal(0);
  });
});

describe("npmReleaseCooldownLabel", () => {
  it("should label off and day-length choices", () => {
    npmReleaseCooldownLabel(0).should.equal("Off");
    npmReleaseCooldownLabel(24).should.equal("24 hours");
    npmReleaseCooldownLabel(168).should.equal("7 days");
  });
});
