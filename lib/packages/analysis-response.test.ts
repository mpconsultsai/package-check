import { describe, it } from "vitest";
import {
  buildAnalysisResponse,
  calculateQualityScore,
  countNpmReleases,
  getDaysSinceLastRelease,
} from "@/lib/packages/analysis-response";
import { STABLE_DOTNET_PLATFORM_DOWNLOADS } from "@/lib/nuget/dotnet-platform";
import type { PackageAnalysisResult } from "@/lib/types/package-data";

function result(
  partial: Partial<PackageAnalysisResult> = {},
): PackageAnalysisResult {
  return { packageName: "demo", ...partial } as PackageAnalysisResult;
}

describe("countNpmReleases", () => {
  it("should ignore packument metadata keys", () => {
    countNpmReleases(null).should.equal(0);
    countNpmReleases({
      created: "2020-01-01",
      modified: "2024-01-01",
      unpublished: "2024-01-01",
      "1.0.0": "2021-01-01",
      "1.1.0": "2022-01-01",
    }).should.equal(2);
  });
});

describe("getDaysSinceLastRelease", () => {
  it("should be null without a publish time", () => {
    (getDaysSinceLastRelease(result()) === null).should.be.true;
  });

  it("should count whole days since the current version", () => {
    const iso = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const days = getDaysSinceLastRelease(
      result({
        npm: {
          name: "demo",
          version: "1.2.3",
          description: "",
          time: { created: iso, modified: iso, "1.2.3": iso },
        },
      }),
    );
    days!.should.be.within(9, 10);
  });
});

describe("calculateQualityScore", () => {
  it("should be 0 when there are no factors", () => {
    calculateQualityScore(result()).should.equal(0);
  });

  it("should reward stars, monthly downloads, recent releases, and a clean advisory list", () => {
    const score = calculateQualityScore(
      result({
        github: { stars: 5000 } as PackageAnalysisResult["github"],
        popularity: { dependents: 10 } as PackageAnalysisResult["popularity"],
        downloads: {
          downloads: 10_000_000,
          start: "",
          end: "",
          package: "demo",
        },
        npm: {
          name: "demo",
          version: "1.0.0",
          description: "",
          time: {
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            "1.0.0": new Date().toISOString(),
          },
        },
        security: {
          hasVulnerabilities: false,
          totalCount: 0,
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          vulnerabilities: [],
        },
      }),
    );
    score.should.be.above(80);
  });

  it("should score lifetime downloads and keep a platform package maintained", () => {
    const old = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString();
    const score = calculateQualityScore(
      result({
        ecosystem: "nuget",
        packageName: "System.Runtime",
        downloads: {
          downloads: STABLE_DOTNET_PLATFORM_DOWNLOADS,
          period: "total",
          start: "",
          end: "",
          package: "System.Runtime",
        },
        npm: {
          name: "System.Runtime",
          version: "8.0.0",
          description: "",
          time: { created: old, modified: old, "8.0.0": old },
        },
        security: {
          hasVulnerabilities: true,
          totalCount: 6,
          critical: 1,
          high: 1,
          moderate: 1,
          low: 3,
          vulnerabilities: [],
        },
      }),
    );
    score.should.be.within(1, 100);
  });
});

describe("buildAnalysisResponse", () => {
  it("should shape the client metrics and registry url", () => {
    const response = buildAnalysisResponse(
      "lodash",
      result({
        ecosystem: "npm",
        npm: {
          name: "lodash",
          version: "4.17.21",
          description: "Utility",
          license: "MIT",
          keywords: ["util", "  "],
        },
        downloads: { downloads: 1000, start: "", end: "", package: "lodash" },
        github: { stars: 100, open_issues: 2 } as PackageAnalysisResult["github"],
      }),
    );
    response.packageInfo.latestVersion.should.equal("4.17.21");
    response.packageInfo.license.should.equal("MIT");
    response.packageInfo.registryUrl.should.match(/npmjs\.com/);
    response.packageInfo.keywords!.should.deep.equal(["util"]);
    response.metrics.downloads.should.equal(1000);
    response.metrics.stars.should.equal(100);
    (response.ai === null).should.be.true;
  });
});
