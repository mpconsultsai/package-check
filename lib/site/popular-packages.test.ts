import { describe, it } from "vitest";
import { MAVEN_POPULAR_PACKAGES } from "@/lib/site/example-packages";
import {
  namesFromNpmTopDownloads,
  namesFromNugetSearch,
  namesFromPypiTopDownloads,
  pickExamplePackages,
} from "@/lib/site/popular-packages";

describe("pickExamplePackages", () => {
  it("should draw distinct names from the ranking", () => {
    const rolls = [0, 0.5, 0.99];
    let cursor = 0;
    pickExamplePackages(["a", "b", "c", "d"], 3, () => rolls[cursor++] ?? 0)
      .should.deep.equal(["a", "c", "d"]);
  });

  it("should stop when the ranking is shorter than the sample", () => {
    pickExamplePackages(["only"], 3, () => 0).should.deep.equal(["only"]);
  });
});

describe("namesFromNpmTopDownloads", () => {
  it("should keep the first quoted names", () => {
    const source = "export const topDownload = [\n  'semver',\n  '@types/node',\n  'react',\n];";
    namesFromNpmTopDownloads(source, 2).should.deep.equal([
      "semver",
      "react",
    ]);
  });
});

describe("namesFromPypiTopDownloads", () => {
  it("should read projects in download order", () => {
    namesFromPypiTopDownloads(
      { rows: [{ project: "boto3" }, { project: "requests" }, { project: "" }] },
      10,
    ).should.deep.equal(["boto3", "requests"]);
  });
});

describe("namesFromNugetSearch", () => {
  it("should sort by total downloads", () => {
    namesFromNugetSearch({
      data: [
        { id: "System.Text.Json", totalDownloads: 100 },
        { id: "Microsoft.Extensions.Logging", totalDownloads: 90 },
        { id: "Serilog", totalDownloads: 10 },
        { id: "Newtonsoft.Json", totalDownloads: 50 },
      ],
    }).should.deep.equal(["Newtonsoft.Json", "Serilog"]);
  });
});

describe("Maven Try pool", () => {
  it("should draw varying triples from the curated popular set", () => {
    const a = pickExamplePackages(MAVEN_POPULAR_PACKAGES, 3, () => 0.1);
    const b = pickExamplePackages(MAVEN_POPULAR_PACKAGES, 3, () => 0.9);
    a.should.have.length(3);
    b.should.have.length(3);
    a.should.not.deep.equal(b);
  });
});
