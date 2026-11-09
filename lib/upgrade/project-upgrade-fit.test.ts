import { describe, it } from "vitest";
import {
  buildProjectUpgradeFacts,
  computeProjectUpgradeFit,
  resolveProjectPackageVersion,
  seedNodeVersionFromEngines,
} from "@/lib/upgrade/project-upgrade-fit";

describe("resolveProjectPackageVersion", () => {
  const versions = ["17.0.0", "18.2.0", "18.3.1", "19.0.0"];

  it("should return an exact version when listed", () => {
    resolveProjectPackageVersion("18.2.0", versions)!.should.equal("18.2.0");
  });

  it("should prefer the lowest satisfying version for a range", () => {
    resolveProjectPackageVersion("^18.0.0", versions)!.should.equal("18.2.0");
  });

  it("should return null when the package range cannot be resolved", () => {
    (resolveProjectPackageVersion("^20.0.0", versions) === null).should.equal(
      true,
    );
  });
});

describe("seedNodeVersionFromEngines", () => {
  it("should seed the minimum version from an engines range", () => {
    seedNodeVersionFromEngines(">=18.12.0")!.should.equal("18.12.0");
  });

  it("should return null for empty engines", () => {
    (seedNodeVersionFromEngines(null) === null).should.equal(true);
  });
});

describe("computeProjectUpgradeFit", () => {
  it("should mark peers as satisfies, missing, or conflicts", () => {
    const fit = computeProjectUpgradeFit({
      projectDeps: {
        react: "^17.0.0",
        lodash: "4.17.21",
      },
      projectEnginesNode: ">=16",
      runtimeNode: "16.20.0",
      targetPeers: {
        react: "^18.0.0",
        lodash: "^4.17.0",
        graphql: "^16.0.0",
      },
      targetEngines: { node: ">=18" },
    });

    const byName = Object.fromEntries(fit.peers.map((p) => [p.name, p]));
    byName.react.status.should.equal("conflicts");
    byName.lodash.status.should.equal("satisfies");
    byName.graphql.status.should.equal("missing");
    fit.engines.projectSatisfiesTarget!.should.equal(false);
    fit.conflictCount.should.be.greaterThan(0);
    fit.missingCount.should.equal(1);

    const facts = buildProjectUpgradeFacts({
      hasContext: true,
      fingerprint: "fp",
      packageRequested: "^1.0.0",
      fit,
      enginesNode: ">=16",
    });
    facts.enginesConflict.should.equal(true);
    facts.peerFits.some((p) => p.name === "react").should.equal(true);
    facts.peerFits.some((p) => p.status === "satisfies").should.equal(false);
  });

  it("should treat intersecting ranges as satisfies", () => {
    const fit = computeProjectUpgradeFit({
      projectDeps: { webpack: "^5.80.0" },
      projectEnginesNode: ">=18",
      runtimeNode: "20.11.0",
      targetPeers: { webpack: ">=5.0.0" },
      targetEngines: { node: ">=18" },
    });
    fit.peers[0].status.should.equal("satisfies");
    fit.engines.projectSatisfiesTarget!.should.equal(true);
    fit.conflictCount.should.equal(0);
  });
});
