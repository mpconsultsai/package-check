import { describe, it } from "vitest";
import {
  compactAdvisories,
  compactDependencyAdvisories,
  getWatchlistAlerts,
  summarizeWatchlistAlerts,
  watchlistAfterAcknowledge,
  watchlistAfterPoll,
  watchlistAfterVisit,
  watchlistEntryHasAlerts,
  type WatchlistEntry,
} from "@/lib/prefs/watchlist-alerts";

function entry(partial: Partial<WatchlistEntry>): WatchlistEntry {
  return {
    name: "express",
    ecosystem: "npm",
    pinnedAt: 1,
    ...partial,
  };
}

const advisory = {
  id: "GHSA-1",
  title: "Open redirect",
  severity: "high" as const,
};

describe("getWatchlistAlerts", () => {
  it("should name an advisory that was not in the acknowledged list", () => {
    const alerts = getWatchlistAlerts(
      entry({
        summary: {
          version: "4.0.0",
          vulnerabilityCount: 0,
          advisories: [],
          dependencyAdvisories: [],
        },
        fresh: {
          version: "4.0.0",
          vulnerabilityCount: 1,
          advisories: [advisory],
          dependencyAdvisories: [],
        },
      }),
    );
    alerts.newVulns.should.equal(true);
    alerts.newAdvisories.should.deep.equal([advisory]);
  });

  it("should fall back to the count when older saved data has no advisory ids", () => {
    const alerts = getWatchlistAlerts(
      entry({
        summary: { version: "1.0.0", vulnerabilityCount: 1 },
        fresh: { version: "1.0.0", vulnerabilityCount: 2, advisories: [advisory] },
      }),
    );
    alerts.newVulns.should.equal(true);
    alerts.newAdvisories.should.deep.equal([]);
  });

  it("should notice a direct dependency that newly has an advisory", () => {
    const alerts = getWatchlistAlerts(
      entry({
        summary: {
          version: "1.0.0",
          dependencyAdvisories: [],
        },
        fresh: {
          version: "1.0.0",
          dependencyAdvisories: [
            { name: "qs", version: "6.5.0", ids: ["GHSA-qs"] },
          ],
        },
      }),
    );
    alerts.newDependencyAdvisories.map((dep) => dep.name).should.deep.equal(["qs"]);
    watchlistEntryHasAlerts(
      entry({
        summary: { dependencyAdvisories: [] },
        fresh: {
          dependencyAdvisories: [{ name: "qs", version: "6.5.0", ids: ["GHSA-qs"] }],
        },
      }),
    ).should.equal(true);
  });
});

describe("watchlistAfterPoll", () => {
  it("should store the first dependency measurement without announcing it", () => {
    const next = watchlistAfterPoll(
      entry({
        summary: { version: "1.0.0", vulnerabilityCount: 0 },
        fresh: { version: "1.0.0", vulnerabilityCount: 0 },
      }),
      {
        version: "1.0.0",
        vulnerabilityCount: 0,
        advisories: [],
        dependencyAdvisories: [{ name: "qs", version: "6.5.0", ids: ["GHSA-qs"] }],
      },
      10,
    );
    next.summary?.dependencyAdvisories?.should.have.length(1);
    watchlistEntryHasAlerts(next).should.equal(false);
  });

  it("should keep a higher advisory count as a notice", () => {
    const next = watchlistAfterPoll(
      entry({ summary: { version: "1.0.0", vulnerabilityCount: 0 } }),
      {
        version: "1.0.0",
        vulnerabilityCount: 1,
        advisories: [advisory],
      },
      10,
    );
    (next.summary?.advisories === undefined).should.equal(true);
    getWatchlistAlerts(next).newVulns.should.equal(true);
  });
});

describe("watchlistAfterVisit", () => {
  it("should leave an unread notice in place when the package page loads", () => {
    const pending = entry({
      summary: { version: "4.0.0", vulnerabilityCount: 0, advisories: [] },
      fresh: { version: "5.0.0", vulnerabilityCount: 0, advisories: [] },
    });
    const next = watchlistAfterVisit(
      pending,
      { version: "5.0.0", vulnerabilityCount: 0, advisories: [], qualityScore: 90 },
      20,
    );
    next.summary?.version!.should.equal("4.0.0");
    next.summary?.qualityScore!.should.equal(90);
    getWatchlistAlerts(next).newVersion.should.equal(true);
  });

  it("should raise a notice when the page is ahead of the acknowledged version", () => {
    const current = entry({
      summary: { version: "4.0.0", vulnerabilityCount: 0, advisories: [] },
      fresh: { version: "4.0.0", vulnerabilityCount: 0, advisories: [] },
    });
    const next = watchlistAfterVisit(
      current,
      { version: "5.0.0", vulnerabilityCount: 0, advisories: [], qualityScore: 88 },
      30,
    );
    next.summary?.version!.should.equal("4.0.0");
    next.fresh?.version!.should.equal("5.0.0");
    getWatchlistAlerts(next).newVersion.should.equal(true);
  });
});

describe("watchlistAfterAcknowledge", () => {
  it("should clear the notice by accepting the latest poll", () => {
    const pending = entry({
      summary: { version: "4.0.0", vulnerabilityCount: 0, advisories: [] },
      fresh: {
        version: "5.0.0",
        vulnerabilityCount: 1,
        advisories: [advisory],
      },
    });
    const next = watchlistAfterAcknowledge(pending);
    next.summary?.version!.should.equal("5.0.0");
    watchlistEntryHasAlerts(next).should.equal(false);
  });
});

describe("summarizeWatchlistAlerts", () => {
  it("should light a security tone for a dependency advisory on any registry", () => {
    const summary = summarizeWatchlistAlerts([
      entry({
        ecosystem: "pypi",
        name: "requests",
        summary: { version: "2.0.0", dependencyAdvisories: [] },
        fresh: {
          version: "2.0.0",
          dependencyAdvisories: [{ name: "urllib3", version: "1.0.0", ids: ["GHSA-u"] }],
        },
      }),
    ]);
    summary.total.should.equal(1);
    summary.tone.should.equal("vulns");
  });
});

describe("compactAdvisories", () => {
  it("should keep known severities and drop rows without an id or title", () => {
    const compact = compactAdvisories([
      { id: "GHSA-1", title: "Open redirect", severity: "HIGH" },
      { id: "GHSA-2", title: "Odd", severity: "unknown" },
      { id: " ", title: "Missing id" },
      { id: "GHSA-3" },
    ]);
    compact.should.have.length(2);
    compact[0]!.severity.should.equal("high");
    compact[1]!.severity.should.equal("low");
  });
});

describe("compactDependencyAdvisories", () => {
  it("should sort by name and drop dependencies with no advisory ids", () => {
    const compact = compactDependencyAdvisories([
      { name: "qs", version: "6.0.0", ids: ["GHSA-q"] },
      { name: "body-parser", version: "1.0.0", ids: [] },
      { name: "cookie", version: "0.4.0", ids: ["GHSA-c"] },
    ]);
    compact.map((dep) => dep.name).should.deep.equal(["cookie", "qs"]);
  });
});
