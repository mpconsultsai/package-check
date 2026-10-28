import { describe, it } from "vitest";
import {
  PACKAGE_ECOSYSTEMS,
  advisoryEcosystem,
  packagePagePath,
  parsePackageRoute,
  registryLabel,
  registryPackageUrl,
  watchlistEntryKey,
} from "@/lib/packages/package-routes";

describe("registry labels and urls", () => {
  it("should list npm, pypi, nuget, and maven", () => {
    PACKAGE_ECOSYSTEMS.should.deep.equal(["npm", "pypi", "nuget", "maven"]);
  });

  it("should label PyPI, NuGet, and Maven and keep npm lowercase", () => {
    registryLabel("pypi").should.equal("PyPI");
    registryLabel("nuget").should.equal("NuGet");
    registryLabel("maven").should.equal("Maven");
    registryLabel("npm").should.equal("npm");
  });

  it("should point at the public registry page", () => {
    registryPackageUrl("npm", "@types/node").should.equal(
      "https://www.npmjs.com/package/%40types%2Fnode",
    );
    registryPackageUrl("pypi", "requests").should.equal(
      "https://pypi.org/project/requests/",
    );
    registryPackageUrl("nuget", "Newtonsoft.Json").should.equal(
      "https://www.nuget.org/packages/Newtonsoft.Json",
    );
    registryPackageUrl("maven", "com.google.guava:guava").should.equal(
      "https://central.sonatype.com/artifact/com.google.guava/guava",
    );
  });

  it("should map PyPI advisories to pip and Maven to maven", () => {
    advisoryEcosystem("pypi").should.equal("pip");
    advisoryEcosystem("nuget").should.equal("nuget");
    advisoryEcosystem("maven").should.equal("maven");
    advisoryEcosystem("npm").should.equal("npm");
  });
});

describe("package page routes", () => {
  it("should build an encoded page path", () => {
    packagePagePath("npm", " @types/node ").should.equal("/npm/%40types%2Fnode");
  });

  it("should parse ecosystem routes and the legacy /package/ path", () => {
    parsePackageRoute("/pypi/requests/extra")!.should.deep.equal({
      ecosystem: "pypi",
      name: "requests",
    });
    parsePackageRoute("/package/lodash")!.should.deep.equal({
      ecosystem: "npm",
      name: "lodash",
    });
  });

  it("should be null for a home path or an empty segment", () => {
    (parsePackageRoute("/") === null).should.be.true;
    (parsePackageRoute("/npm/") === null).should.be.true;
    (parsePackageRoute("/package/") === null).should.be.true;
  });

  it("should keep a malformed escape as the raw segment", () => {
    parsePackageRoute("/nuget/%")!.name.should.equal("%");
    parsePackageRoute("/package/%")!.name.should.equal("%");
  });

  it("should key the watchlist by ecosystem and lowercase name", () => {
    watchlistEntryKey("nuget", "Newtonsoft.Json").should.equal(
      "nuget:newtonsoft.json",
    );
  });
});
