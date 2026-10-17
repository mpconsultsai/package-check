import { describe, it } from "vitest";
import {
  dependencyReactKey,
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
