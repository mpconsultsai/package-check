import { describe, it } from "vitest";
import { featuresForEcosystem } from "@/lib/packages/ecosystem-features";

describe("featuresForEcosystem", () => {
  it("should enable npm charts and the upgrade advisor", () => {
    const features = featuresForEcosystem("npm");
    features.downloadCharts.should.be.true;
    features.transitiveDepsTree.should.be.true;
    features.upgradeAdvisor.should.be.true;
    features.relatedPackages.should.be.true;
    features.downloadsAreTotal.should.be.false;
  });

  it("should show NuGet lifetime downloads and related packages without an upgrade advisor", () => {
    const features = featuresForEcosystem("nuget");
    features.downloadCharts.should.be.false;
    features.downloadMetrics.should.be.true;
    features.downloadsAreTotal.should.be.true;
    features.relatedPackages.should.be.true;
    features.upgradeAdvisor.should.be.false;
    features.transitiveDepsTree.should.be.false;
    features.pasteList.should.be.true;
  });

  it("should keep PyPI charts without download totals or related packages", () => {
    const features = featuresForEcosystem("pypi");
    features.chartsTab.should.be.true;
    features.downloadMetrics.should.be.false;
    features.relatedPackages.should.be.false;
    features.pasteList.should.be.true;
  });
});
