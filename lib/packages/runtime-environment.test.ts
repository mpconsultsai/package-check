import { describe, it } from "vitest";
import {
  classifyRuntimeEnvironment,
  isConfidentRuntime,
} from "@/lib/packages/runtime-environment";

describe("classifyRuntimeEnvironment", () => {
  it("should be unclear with no signals", () => {
    const runtime = classifyRuntimeEnvironment({});
    runtime.kind.should.equal("unclear");
    runtime.confidence.should.equal("low");
  });

  it("should treat a React peer as a client package", () => {
    const runtime = classifyRuntimeEnvironment({
      peerDependencies: { react: "^19" },
      keywords: ["ui"],
    });
    runtime.kind.should.equal("client");
    runtime.reasons.join(" ").should.match(/react/);
  });

  it("should treat Express as a server package", () => {
    classifyRuntimeEnvironment({
      dependencies: { express: "^4" },
      bin: { cli: "bin.js" },
    }).kind.should.equal("server");
  });

  it("should be both when client and server signals are strong", () => {
    classifyRuntimeEnvironment({
      peerDependencies: { react: "^19" },
      dependencies: { express: "^4" },
      keywords: ["ssr"],
    }).kind.should.equal("both");
  });
});

describe("isConfidentRuntime", () => {
  it("should hide unclear and low-confidence guesses", () => {
    isConfidentRuntime(null).should.be.false;
    isConfidentRuntime({ kind: "unclear", confidence: "high" }).should.be.false;
    isConfidentRuntime({ kind: "client", confidence: "low" }).should.be.false;
  });

  it("should keep a medium or high classification", () => {
    isConfidentRuntime({ kind: "server", confidence: "medium" }).should.be.true;
    isConfidentRuntime({ kind: "client", confidence: "high" }).should.be.true;
  });
});
