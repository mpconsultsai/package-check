import { describe, it } from "vitest";
import { parsePep508Line, stripRequirementLine } from "@/lib/parse/parse-pep508-line";

describe("stripRequirementLine", () => {
  it("should drop comments and environment markers", () => {
    stripRequirementLine("  requests>=2 ; python_version >= '3.8'  # pin ").should.equal(
      "requests>=2",
    );
    stripRequirementLine("# comment").should.equal("");
  });
});

describe("parsePep508Line", () => {
  it("should parse a name and a version spec", () => {
    parsePep508Line("Requests[security] >= 2.28")!.should.deep.equal({
      name: "Requests",
      requested: ">= 2.28",
    });
  });

  it("should skip requirements options, urls, and invalid names", () => {
    (parsePep508Line("-r other.txt") === null).should.be.true;
    (parsePep508Line("https://example.com/pkg.whl") === null).should.be.true;
    (parsePep508Line("@scope/pkg") === null).should.be.true;
  });

  it("should skip a direct VCS reference", () => {
    (parsePep508Line("pkg @ git+https://github.com/org/pkg") === null).should.be.true;
  });
});
