import { describe, it } from "vitest";
import {
  advisoryStillAffects,
  compareManifests,
  manifestFromVersionDoc,
} from "@/lib/upgrade/upgrade-manifest";

describe("manifestFromVersionDoc", () => {
  it("should keep deprecation, engines, and dependency ranges", () => {
    const manifest = manifestFromVersionDoc({
      deprecated: " Upgrade to 5 ",
      type: "module",
      engines: { node: ">=18" },
      dependencies: { qs: "^6.0.0" },
      peerDependencies: { react: "^19" },
    });
    manifest!.deprecated!.should.equal("Upgrade to 5");
    manifest!.moduleType!.should.equal("module");
    manifest!.engines.node.should.equal(">=18");
    manifest!.dependencies.qs.should.equal("^6.0.0");
    manifest!.peerDependencies.react.should.equal("^19");
  });
});

describe("compareManifests", () => {
  it("should list engine, module, and dependency changes", () => {
    const diff = compareManifests(
      {
        deprecated: "old line",
        moduleType: null,
        engines: { node: ">=10" },
        dependencies: { qs: "^6.0.0", cookie: "^0.4.0" },
        peerDependencies: {},
      },
      {
        deprecated: null,
        moduleType: "module",
        engines: { node: ">=18" },
        dependencies: { qs: "^6.13.0", debug: "^4.0.0" },
        peerDependencies: {},
      },
    );
    diff.deprecation.from!.should.equal("old line");
    diff.moduleType!.to!.should.equal("module");
    diff.engines.should.deep.equal([
      { kind: "changed", name: "node", from: ">=10", to: ">=18" },
    ]);
    diff.dependencies.map((change) => change.name).should.deep.equal([
      "cookie",
      "debug",
      "qs",
    ]);
  });
});

describe("advisoryStillAffects", () => {
  it("should say whether the target version is still in range", () => {
    (advisoryStillAffects("4.17.20", "<4.17.21") === true).should.equal(true);
    (advisoryStillAffects("4.17.21", "<4.17.21") === false).should.equal(true);
    (advisoryStillAffects("5.0.0", "") === null).should.equal(true);
  });
});
