import { describe, it } from "vitest";
import { decodePackageParam, packagePageMetadata } from "@/lib/packages/package-page-meta";

describe("decodePackageParam", () => {
  it("should decode a package segment", () => {
    decodePackageParam("%40types%2Fnode").should.equal("@types/node");
  });

  it("should keep a malformed escape", () => {
    decodePackageParam("%").should.equal("%");
  });
});

describe("packagePageMetadata", () => {
  it("should describe an npm review", () => {
    const meta = packagePageMetadata("npm", "lodash");
    meta.title!.should.equal("lodash npm package review");
    meta.description!.should.match(/npm package lodash/);
    meta.alternates!.canonical!.should.equal("/npm/lodash");
  });

  it("should describe PyPI and NuGet reviews", () => {
    packagePageMetadata("pypi", "requests").description!.should.match(/PyPI project/);
    packagePageMetadata("nuget", "Serilog").description!.should.match(/NuGet package/);
    packagePageMetadata("nuget", "A B").alternates!.canonical!.should.equal(
      "/nuget/A%20B",
    );
  });
});
