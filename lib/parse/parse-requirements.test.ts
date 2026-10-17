import { describe, it } from "vitest";
import {
  parseDependencyListForEcosystem,
  parseRequirementsList,
} from "@/lib/parse/parse-requirements";

describe("parseRequirementsList", () => {
  it("should be empty for blank input", () => {
    parseRequirementsList("\n").source.should.equal("empty");
  });

  it("should parse requirements.txt lines and count invalid ones", () => {
    const parsed = parseRequirementsList(
      "# pin\nrequests>=2.28\nhttps://example.com/pkg.whl\n",
    );
    parsed.source.should.equal("requirements.txt");
    parsed.packages.should.deep.equal(["requests"]);
    parsed.invalidCount.should.equal(1);
  });
});

describe("parseDependencyListForEcosystem", () => {
  it("should route each registry to its parser", () => {
    parseDependencyListForEcosystem("requests", "pypi").packages.should.deep.equal([
      "requests",
    ]);
    parseDependencyListForEcosystem("Serilog", "nuget").packages.should.deep.equal([
      "Serilog",
    ]);
    parseDependencyListForEcosystem("lodash", "npm").packages.should.deep.equal([
      "lodash",
    ]);
  });
});
