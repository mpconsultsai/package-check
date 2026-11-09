import { describe, it } from "vitest";
import {
  evaluateReversePeerFit,
  targetSatisfiesPeerRange,
} from "@/lib/upgrade/project-reverse-peer-fit";

describe("targetSatisfiesPeerRange", () => {
  it("should accept a target inside the peer range", () => {
    targetSatisfiesPeerRange("5.7.2", "^5.0.0")!.should.equal(true);
  });

  it("should reject a target outside the peer range", () => {
    targetSatisfiesPeerRange("6.0.0", "^5.0.0")!.should.equal(false);
  });
});

describe("evaluateReversePeerFit", () => {
  it("should mark conflicts when a consumer peer rejects the upgrade target", () => {
    const fit = evaluateReversePeerFit({
      consumerName: "@typescript-eslint/parser",
      consumerVersion: "8.0.0",
      peerRange: "^5.0.0",
      targetVersion: "6.0.0",
    });
    fit.status.should.equal("conflicts");
    fit.required.should.equal("^5.0.0");
  });

  it("should mark satisfies when the consumer accepts the target", () => {
    const fit = evaluateReversePeerFit({
      consumerName: "ts-node",
      consumerVersion: "10.9.2",
      peerRange: ">=4.2 <6",
      targetVersion: "5.7.2",
    });
    fit.status.should.equal("satisfies");
  });
});
