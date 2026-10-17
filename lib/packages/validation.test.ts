import { describe, it } from "vitest";
import {
  extractPackageName,
  normalizeNpmPackageName,
  validateNugetPackageName,
  validatePackageName,
  validatePackageNameForEcosystem,
  validatePyPiPackageName,
} from "@/lib/packages/validation";

describe("extractPackageName", () => {
  it("should keep the first token of a scoped name", () => {
    extractPackageName("  @graphql-inspector/cli graphql ").should.equal(
      "@graphql-inspector/cli",
    );
  });

  it("should be an empty string when the input is blank", () => {
    extractPackageName("   ").should.equal("");
  });
});

describe("normalizeNpmPackageName", () => {
  it("should lowercase an npm name", () => {
    normalizeNpmPackageName("Lodash").should.equal("lodash");
  });

  it("should add a missing @ for scope/name", () => {
    normalizeNpmPackageName("Angular/Core").should.equal("@angular/core");
  });

  it("should leave an already scoped name unchanged apart from case", () => {
    normalizeNpmPackageName("@Angular/Core").should.equal("@angular/core");
  });
});

describe("validatePackageName", () => {
  it("should accept an unscoped name and a scoped name", () => {
    validatePackageName("lodash").valid.should.be.true;
    validatePackageName("@graphql-inspector/core").valid.should.be.true;
  });

  it("should require a package name", () => {
    const result = validatePackageName("  ");
    result.valid.should.be.false;
    result.error!.should.equal("Package name is required");
  });

  it("should explain a scope-only name", () => {
    const result = validatePackageName("@graphql-inspector");
    result.valid.should.be.false;
    result.error!.should.match(/Scoped packages must include the package name/);
  });

  it("should reject a name that is not lowercase npm syntax", () => {
    const result = validatePackageName("Not-Valid");
    result.valid.should.be.false;
    result.error!.should.match(/Invalid package name format/);
  });
});

describe("validatePyPiPackageName", () => {
  it("should accept a PEP 503 name", () => {
    validatePyPiPackageName("LangGraph").valid.should.be.true;
  });

  it("should require a project name", () => {
    validatePyPiPackageName("").valid.should.be.false;
  });

  it("should reject a scoped npm-style name", () => {
    validatePyPiPackageName("@scope/pkg").valid.should.be.false;
  });
});

describe("validateNugetPackageName", () => {
  it("should accept Newtonsoft.Json", () => {
    validateNugetPackageName("Newtonsoft.Json").valid.should.be.true;
  });

  it("should require a package id", () => {
    validateNugetPackageName("").error!.should.equal("Package id is required");
  });

  it("should reject an id longer than 100 characters", () => {
    validateNugetPackageName(`${"A".repeat(101)}`).valid.should.be.false;
  });
});

describe("validatePackageNameForEcosystem", () => {
  it("should use the PyPI rules for pypi", () => {
    validatePackageNameForEcosystem("requests", "pypi").valid.should.be.true;
  });

  it("should use the NuGet rules for nuget", () => {
    validatePackageNameForEcosystem("Serilog", "nuget").valid.should.be.true;
  });

  it("should use the npm rules otherwise", () => {
    validatePackageNameForEcosystem("@types/node", "npm").valid.should.be.true;
  });
});
