import { describe, it } from "vitest";
import {
  attachDirectAdvisories,
  dependencyReactKey,
  formatDirectAdvisoryLine,
  listPackageDependencies,
} from "@/lib/packages/package-deps";

describe("listPackageDependencies", () => {
  it("should sort runtime dependencies and drop blank entries", () => {
    listPackageDependencies(
      { zod: " ^4 ", "": "1.0.0", axios: "1.0.0" },
      null,
    ).map((dep) => dep.name).should.deep.equal(["axios", "zod"]);
  });

  it("should prefer the runtime entry when the peer name matches", () => {
    const deps = listPackageDependencies(
      { React: "19.0.0" },
      { react: "^18", left: "1.0.0" },
    );
    deps.map((dep) => `${dep.kind}:${dep.name}`).should.deep.equal([
      "runtime:React",
      "peer:left",
    ]);
  });
});

describe("attachDirectAdvisories", () => {
  it("should mark only direct dependencies that have advisories", () => {
    const marked = attachDirectAdvisories(
      [
        { name: "qs", range: "^6.16.0", kind: "runtime" },
        { name: "debug", range: "^4.4.0", kind: "runtime" },
      ],
      [
        {
          name: "qs",
          version: "6.14.0",
          relation: "DIRECT",
          advisoryCount: 1,
          advisoryIds: ["GHSA-example"],
        },
        {
          name: "debug",
          version: "4.4.0",
          relation: "DIRECT",
          advisoryCount: 0,
          advisoryIds: [],
        },
        {
          name: "qs",
          version: "6.5.0",
          relation: "INDIRECT",
          advisoryCount: 3,
          advisoryIds: ["GHSA-old"],
        },
      ],
    );
    marked[0].advisoryCount!.should.equal(1);
    marked[0].resolvedVersion!.should.equal("6.14.0");
    marked[0].advisoryIds!.should.deep.equal(["GHSA-example"]);
    (marked[1].advisoryCount === undefined).should.equal(true);
  });
});

describe("formatDirectAdvisoryLine", () => {
  it("should name the advisory ids", () => {
    formatDirectAdvisoryLine({
      name: "qs",
      version: "6.14.0",
      advisoryCount: 1,
      advisoryIds: ["GHSA-example"],
    }).should.equal("qs@6.14.0 has advisories: GHSA-example");
  });
});

describe("dependencyReactKey", () => {
  it("should include the marker and index", () => {
    dependencyReactKey(
      {
        name: "requests",
        range: ">=2",
        kind: "runtime",
        marker: "sys_platform == 'win32'",
      },
      3,
    ).should.equal("runtime:requests:>=2:sys_platform == 'win32':3");
  });
});
