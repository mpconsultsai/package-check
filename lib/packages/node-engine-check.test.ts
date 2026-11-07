import { describe, it } from "vitest";
import {
  checkNodeAgainstTargetEngines,
  nodeSatisfiesEngine,
  targetNodeEngineRange,
} from "@/lib/packages/node-engine-check";

describe("nodeSatisfiesEngine", () => {
  it("should accept modern Node against >=8", () => {
    (nodeSatisfiesEngine("20.11.1", ">=8") === true).should.equal(true);
    (nodeSatisfiesEngine("6.0.0", ">=8") === false).should.equal(true);
  });
});

describe("targetNodeEngineRange", () => {
  it("should read the target range from a changed engines.node entry", () => {
    targetNodeEngineRange([
      { name: "node", kind: "changed", from: ">=0.10.0", to: ">=8" },
    ])!.should.equal(">=8");
  });
});

describe("checkNodeAgainstTargetEngines", () => {
  it("should warn when the runtime is missing", () => {
    const check = checkNodeAgainstTargetEngines({
      nodeVersion: "",
      engines: [{ name: "node", kind: "changed", from: ">=0.10", to: ">=8" }],
    });
    check.required!.should.equal(">=8");
    (check.satisfies === null).should.equal(true);
    check.message!.should.match(/Enter the runtime Node version/);
  });

  it("should flag an incompatible runtime", () => {
    const check = checkNodeAgainstTargetEngines({
      nodeVersion: "6.17.1",
      engines: [{ name: "node", kind: "changed", from: ">=0.10", to: ">=8" }],
    });
    (check.satisfies === false).should.equal(true);
  });
});
