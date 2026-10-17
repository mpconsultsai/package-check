import { describe, it } from "vitest";
import {
  STABLE_DOTNET_PLATFORM_DOWNLOADS,
  isDotnetInboxPackageId,
  isStableDotnetPlatformPackage,
} from "@/lib/nuget/dotnet-platform";
import type { PackageAnalysisResult } from "@/lib/types/package-data";

describe("isDotnetInboxPackageId", () => {
  it("should match System.* and Microsoft.* ids", () => {
    isDotnetInboxPackageId(" System.Text.Json ").should.be.true;
    isDotnetInboxPackageId("Microsoft.Extensions.Logging").should.be.true;
  });

  it("should leave community packages alone", () => {
    isDotnetInboxPackageId("Newtonsoft.Json").should.be.false;
    isDotnetInboxPackageId("system").should.be.false;
  });
});

describe("isStableDotnetPlatformPackage", () => {
  const platform = {
    ecosystem: "nuget",
    packageName: "System.Runtime",
    downloads: {
      downloads: STABLE_DOTNET_PLATFORM_DOWNLOADS,
      period: "total",
      start: "",
      end: "",
      package: "System.Runtime",
    },
  } as PackageAnalysisResult;

  it("should be true for a heavily downloaded inbox package", () => {
    isStableDotnetPlatformPackage(platform).should.be.true;
  });

  it("should be false for npm, monthly totals, low downloads, or community ids", () => {
    isStableDotnetPlatformPackage({
      ...platform,
      ecosystem: "npm",
    }).should.be.false;
    isStableDotnetPlatformPackage({
      ...platform,
      downloads: { ...platform.downloads!, period: "month" },
    }).should.be.false;
    isStableDotnetPlatformPackage({
      ...platform,
      downloads: {
        ...platform.downloads!,
        downloads: STABLE_DOTNET_PLATFORM_DOWNLOADS - 1,
      },
    }).should.be.false;
    isStableDotnetPlatformPackage({
      ...platform,
      packageName: "Newtonsoft.Json",
    }).should.be.false;
  });
});
