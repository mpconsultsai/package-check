import { describe, it } from "vitest";
import { formatNugetDescription, dotnetApiReferenceUrl } from "@/lib/nuget-description";

describe("dotnetApiReferenceUrl", () => {
  it("should link a type to learn.microsoft.com", () => {
    dotnetApiReferenceUrl("System.Text.Json.JsonSerializer")!.should.equal(
      "https://learn.microsoft.com/dotnet/api/system.text.json.jsonserializer",
    );
  });

  it("should include generic arity", () => {
    dotnetApiReferenceUrl("System.Collections.Generic.List<T>")!.should.equal(
      "https://learn.microsoft.com/dotnet/api/system.collections.generic.list-1",
    );
  });

  it("should be null for a name that is not a dotted type", () => {
    (dotnetApiReferenceUrl("JsonSerializer") === null).should.be.true;
  });
});

describe("formatNugetDescription", () => {
  it("should be empty for a missing description", () => {
    formatNugetDescription(null).should.deep.equal({
      description: "",
      commonlyUsedTypes: [],
      note: null,
    });
    formatNugetDescription("   ").description.should.equal("");
  });

  it("should collapse prose when there is no type list", () => {
    formatNugetDescription("Hello\n\nworld <b>there</b>").description.should.equal(
      "Hello world there",
    );
  });

  it("should prefer the catalog summary and drop the platform list", () => {
    const formatted = formatNugetDescription(
      "NUnit is a unit-testing framework for all .NET languages.\n\nIf you are upgrading from NUnit 3, see the migration guide (https://docs.nunit.org/articles/nunit/release-notes/breaking-changes.html).\n\nSupported platforms:\n- .NET Framework 4.6.2+\n- .NET 8.0+",
      "NUnit is a unit-testing framework for all .NET languages with a strong TDD focus.",
    );
    formatted.description.should.equal(
      "NUnit is a unit-testing framework for all .NET languages with a strong TDD focus.",
    );
    formatted.description.should.not.match(/Supported platforms|migration guide/);
  });

  it("should omit a supported-platforms list when there is no summary", () => {
    formatNugetDescription(
      "JSON for .NET\n\nSupported platforms:\n- .NET 8.0+",
    ).description.should.equal("JSON for .NET");
  });

  it("should split commonly used types and keep a trailing note", () => {
    const formatted = formatNugetDescription(
      "JSON for .NET\n\nCommonly Used Types:\nSystem.Text.Json.JsonSerializer\nSystem.Collections.Generic.List<T>\nRequires NuGet 2.12 or higher.",
    );
    formatted.description.should.equal("JSON for .NET");
    formatted.commonlyUsedTypes.should.deep.equal([
      "System.Text.Json.JsonSerializer",
      "System.Collections.Generic.List<T>",
    ]);
    formatted.note!.should.match(/Requires NuGet 2.12/);
  });
});
