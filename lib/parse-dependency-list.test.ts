import { describe, it } from "vitest";
import {
  parseDependencyList,
  stripVersionConstraint,
} from "@/lib/parse-dependency-list";

describe("stripVersionConstraint", () => {
  it("should drop the version from scoped and unscoped specs", () => {
    stripVersionConstraint("lodash@1.2.3").should.equal("lodash");
    stripVersionConstraint('"@scope/pkg@^1.0.0"').should.equal("@scope/pkg");
    stripVersionConstraint("@scope").should.equal("@scope");
    stripVersionConstraint("").should.equal("");
  });
});

describe("parseDependencyList", () => {
  it("should be empty for blank input", () => {
    parseDependencyList("  ").source.should.equal("empty");
  });

  it("should read package.json dependency blocks", () => {
    const parsed = parseDependencyList(
      JSON.stringify({
        dependencies: { react: "^19.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    parsed.source.should.equal("package.json");
    parsed.packages.should.have.members(["react", "typescript"]);
    parsed.entries.find((entry) => entry.name === "react")!.requested!.should.equal(
      "^19.0.0",
    );
  });

  it("should read a plain list with versions", () => {
    const parsed = parseDependencyList("lodash@4.17.21\naxios");
    parsed.source.should.equal("text");
    parsed.entries.should.deep.equal([
      { name: "lodash", requested: "4.17.21" },
      { name: "axios", requested: undefined },
    ]);
  });
});
