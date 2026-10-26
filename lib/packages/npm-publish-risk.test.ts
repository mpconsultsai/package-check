import { describe, it } from "vitest";
import {
  YOUNG_PACKAGE_DAYS,
  assessNpmPublishRisk,
} from "./npm-publish-risk";

describe("assessNpmPublishRisk", () => {
  const now = new Date("2026-10-25T12:00:00.000Z").getTime();

  it("should note a young package and a solo maintainer", () => {
    const createdAt = "2026-10-01T00:00:00.000Z";
    const ageDays = Math.floor(
      (now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    ageDays.should.be.below(YOUNG_PACKAGE_DAYS);

    const risk = assessNpmPublishRisk({
      createdAt,
      maintainers: [{ name: "alice" }],
      latestVersion: "1.0.0",
      versions: {
        "1.0.0": { _npmUser: { name: "alice" } },
      },
      versionTimes: {
        created: createdAt,
        "1.0.0": createdAt,
      },
      now,
    });
    risk.notes.should.deep.equal([
      `Package created ${ageDays} days ago.`,
      "Single maintainer.",
    ]);
    risk.maintainerCount.should.equal(1);
  });

  it("should note a first-time publisher on an established package", () => {
    const risk = assessNpmPublishRisk({
      createdAt: "2020-01-01T00:00:00.000Z",
      maintainers: [{ name: "alice" }, { name: "bob" }],
      latestVersion: "2.0.0",
      versions: {
        "1.0.0": { _npmUser: { name: "alice" } },
        "2.0.0": { _npmUser: { name: "eve" } },
      },
      versionTimes: {
        created: "2020-01-01T00:00:00.000Z",
        "1.0.0": "2020-01-02T00:00:00.000Z",
        "2.0.0": "2026-10-20T00:00:00.000Z",
      },
      now,
    });
    risk.newPublisher.should.equal(true);
    risk.notes.should.deep.equal(["First publish by eve on this package."]);
  });

  it("should stay quiet for a mature multi-maintainer package", () => {
    const risk = assessNpmPublishRisk({
      createdAt: "2018-01-01T00:00:00.000Z",
      maintainers: [{ name: "alice" }, { name: "bob" }],
      latestVersion: "3.0.0",
      versions: {
        "2.0.0": { _npmUser: { name: "alice" } },
        "3.0.0": { _npmUser: { name: "alice" } },
      },
      versionTimes: {
        created: "2018-01-01T00:00:00.000Z",
        "2.0.0": "2024-01-01T00:00:00.000Z",
        "3.0.0": "2026-01-01T00:00:00.000Z",
      },
      now,
    });
    risk.notes.should.deep.equal([]);
    risk.newPublisher.should.equal(false);
  });
});
