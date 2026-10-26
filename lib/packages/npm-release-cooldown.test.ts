import { describe, it } from "vitest";
import {
  formatHoursSincePublish,
  isWithinNpmReleaseCooldown,
  npmReleaseCooldownCaution,
  npmReleaseCooldownStatus,
} from "@/lib/packages/npm-release-cooldown";

const HOUR = 1000 * 60 * 60;

describe("npmReleaseCooldownStatus", () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");

  it("should flag a publish younger than the cooldown", () => {
    const status = npmReleaseCooldownStatus({
      publishedAt: new Date(now - 3 * HOUR).toISOString(),
      cooldownHours: 24,
      now,
    });
    status.withinCooldown.should.equal(true);
    (status.hoursSincePublish as number).should.equal(3);
  });

  it("should clear once the cooldown has elapsed", () => {
    const status = npmReleaseCooldownStatus({
      publishedAt: new Date(now - 24 * HOUR).toISOString(),
      cooldownHours: 24,
      now,
    });
    status.withinCooldown.should.equal(false);
    (status.hoursSincePublish as number).should.equal(24);
  });

  it("should stay off when cooldown is 0 or the time is missing", () => {
    isWithinNpmReleaseCooldown({
      publishedAt: new Date(now - HOUR).toISOString(),
      cooldownHours: 0,
      now,
    }).should.equal(false);
    npmReleaseCooldownStatus({
      publishedAt: null,
      cooldownHours: 24,
      now,
    }).should.deep.equal({ withinCooldown: false, hoursSincePublish: null });
    npmReleaseCooldownStatus({
      publishedAt: "not-a-date",
      cooldownHours: 24,
      now,
    }).should.deep.equal({ withinCooldown: false, hoursSincePublish: null });
  });
});

describe("formatHoursSincePublish", () => {
  it("should describe short and day-scale ages", () => {
    formatHoursSincePublish(0).should.equal("less than 1 hour ago");
    formatHoursSincePublish(1).should.equal("1 hour ago");
    formatHoursSincePublish(3).should.equal("3 hours ago");
    formatHoursSincePublish(48).should.equal("2 days ago");
  });
});

describe("npmReleaseCooldownCaution", () => {
  it("should mention the age and the configured window", () => {
    npmReleaseCooldownCaution({
      hoursSincePublish: 3,
      cooldownHours: 24,
    }).should.equal("Published 3 hours ago · under your 24-hour cooldown");
  });
});
