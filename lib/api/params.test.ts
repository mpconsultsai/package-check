import type { NextRequest } from "next/server";
import { describe, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import {
  parseEcosystem,
  readJsonBody,
  requireEcosystemFromQuery,
  requireFromTo,
  requirePackageFromQuery,
  requirePackageFromQueryWithEcosystem,
  requirePackageName,
  requirePackageNameForEcosystem,
  requireVersion,
} from "@/lib/api/params";

function request(query: string, body?: unknown): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api${query}`),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("parseEcosystem", () => {
  it("should accept npm, pypi, pip, and nuget", () => {
    parseEcosystem("PyPI").should.equal("pypi");
    parseEcosystem("pip").should.equal("pypi");
    parseEcosystem("nuget").should.equal("nuget");
    parseEcosystem("npm").should.equal("npm");
  });

  it("should fall back when the value is unknown", () => {
    parseEcosystem("maven", "nuget").should.equal("nuget");
    parseEcosystem(null).should.equal("npm");
  });
});

describe("requirePackageName", () => {
  it("should return a valid npm name", () => {
    requirePackageName(" lodash extra ").should.equal("lodash");
  });

  it("should throw when the name is missing or invalid", () => {
    const missing = () => requirePackageName("  ");
    missing.should.throw(AppError, "Package name is required");
    const invalid = () => requirePackageName("@graphql-inspector");
    invalid.should.throw(AppError);
  });
});

describe("requirePackageNameForEcosystem", () => {
  it("should accept a NuGet id", () => {
    requirePackageNameForEcosystem("Newtonsoft.Json", "nuget").should.equal(
      "Newtonsoft.Json",
    );
  });

  it("should throw for an invalid PyPI name", () => {
    const invalid = () => requirePackageNameForEcosystem("@scope/pkg", "pypi");
    invalid.should.throw(AppError);
  });
});

describe("query helpers", () => {
  it("should read the package and ecosystem from the query", () => {
    requirePackageFromQuery(request("?package=react")).should.equal("react");
    requireEcosystemFromQuery(request("?ecosystem=nuget")).should.equal("nuget");
    requirePackageFromQueryWithEcosystem(
      request("?package=Serilog&ecosystem=nuget"),
    ).should.deep.equal({ packageName: "Serilog", ecosystem: "nuget" });
  });

  it("should require a version and a from/to pair", () => {
    requireVersion(" 1.2.3 ").should.equal("1.2.3");
    const missingVersion = () => requireVersion(" ");
    missingVersion.should.throw(AppError, "Version is required");
    requireFromTo("1.0.0", "2.0.0").should.deep.equal({
      from: "1.0.0",
      to: "2.0.0",
    });
    const missingRange = () => requireFromTo("", "2.0.0");
    missingRange.should.throw(AppError, "Both from and to versions are required");
  });

});

describe("readJsonBody", () => {
  it("should return an object body", async () => {
    const body = await readJsonBody(request("", { package: "react" }));
    body.should.deep.equal({ package: "react" });
  });

  it("should be an empty object for an array or invalid JSON", async () => {
    (await readJsonBody(request("", ["react"]))).should.deep.equal({});
    const broken = {
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as NextRequest;
    (await readJsonBody(broken)).should.deep.equal({});
  });
});
