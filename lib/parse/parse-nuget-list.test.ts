import { describe, it } from "vitest";
import { parseNugetPackageList } from "@/lib/parse/parse-nuget-list";

describe("parseNugetPackageList", () => {
  it("should be empty for blank input", () => {
    parseNugetPackageList("  ").source.should.equal("empty");
  });

  it("should read a plain list and count invalid lines", () => {
    const parsed = parseNugetPackageList(
      "# comment\nNewtonsoft.Json\n// skip\nbad!\nSerilog\nNewtonsoft.Json",
    );
    parsed.source.should.equal("package list");
    parsed.packages.should.deep.equal(["Newtonsoft.Json", "Serilog"]);
    parsed.invalidCount.should.equal(1);
  });

  it("should read PackageReference versions from attributes and child elements", () => {
    const parsed = parseNugetPackageList(`
      <ItemGroup>
        <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
        <PackageReference Include="Serilog">
          <Version>4.0.0</Version>
        </PackageReference>
        <PackageReference Include="bad!" Version="1.0.0" />
      </ItemGroup>
    `);
    parsed.source.should.equal("csproj");
    parsed.entries.should.deep.equal([
      { name: "Newtonsoft.Json", requested: "13.0.3" },
      { name: "Serilog", requested: "4.0.0" },
    ]);
  });

  it("should keep a requested version when a duplicate appears later", () => {
    const parsed = parseNugetPackageList(`
      <PackageReference Include="Dapper" />
      <PackageReference Include="Dapper" Version="2.1.35" />
    `);
    parsed.entries[0].requested!.should.equal("2.1.35");
  });
});
