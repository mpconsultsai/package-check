import { describe, it } from "vitest";
import { describeDependencySpec } from "@/lib/parse/describe-dependency-spec";

describe("describeDependencySpec", () => {
  it("should be null for a missing spec", () => {
    (describeDependencySpec(undefined) === null).should.be.true;
    (describeDependencySpec("  ") === null).should.be.true;
  });

  it("should describe non-registry, wildcard, and pinned specs", () => {
    describeDependencySpec("workspace:*")!.kind.should.equal("other");
    describeDependencySpec("github:org/repo")!.label.should.equal("Non-registry");
    describeDependencySpec("*")!.should.deep.include({
      kind: "wildcard",
      detail: "any published version",
    });
    describeDependencySpec("1.2.3")!.should.deep.include({
      kind: "pinned",
      detail: "exact 1.2.3",
    });
  });

  it("should explain caret, tilde, and range bounds", () => {
    describeDependencySpec("^1.2.3")!.detail.should.equal("1.2.3 ≤ v < 2.0.0");
    describeDependencySpec("^0.2.3")!.detail.should.equal("0.2.3 ≤ v < 0.3.0");
    describeDependencySpec("^0.0.3")!.detail.should.equal("0.0.3 ≤ v < 0.0.4");
    describeDependencySpec("~1.2.3")!.detail.should.equal("1.2.3 ≤ v < 1.3.0");
    describeDependencySpec(">=1.2.3")!.detail.should.equal("≥ 1.2.3");
  });

  it("should keep an unparseable caret or other spec", () => {
    describeDependencySpec("^not-a-version")!.detail.should.equal("^not-a-version");
    describeDependencySpec("~not-a-version")!.detail.should.equal("~not-a-version");
    describeDependencySpec("not a spec")!.kind.should.equal("other");
  });
});
