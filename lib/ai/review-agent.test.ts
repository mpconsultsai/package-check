import { describe, it } from "vitest";
import { reviewRoute } from "@/lib/ai/review-agent";
import type { PackageAnalysisResult } from "@/lib/types/package-data";

function report(overrides: Partial<PackageAnalysisResult> = {}): PackageAnalysisResult {
  return {
    packageName: "left-pad",
    ecosystem: "npm",
    ...overrides,
  };
}

describe("reviewRoute", () => {
  it("should skip every station for a clean package", () => {
    reviewRoute(report()).should.deep.equal({
      advisories: false,
      dependencies: false,
      installScripts: false,
      scorecard: false,
      transitive: false,
    });
  });

  it("should run advisories, dependencies, scorecard, and the transitive tree for a vulnerable npm package", () => {
    const route = reviewRoute(
      report({
        npm: {
          name: "lodash",
          version: "4.17.21",
          description: "utility",
          dependencies: { tslib: "^2.0.0" },
          repository: { type: "git", url: "git+https://github.com/lodash/lodash.git" },
        },
        security: {
          hasVulnerabilities: true,
          totalCount: 1,
          critical: 0,
          high: 1,
          moderate: 0,
          low: 0,
          vulnerabilities: [],
        },
      }),
    );
    route.should.deep.equal({
      advisories: true,
      dependencies: true,
      installScripts: false,
      scorecard: true,
      transitive: true,
    });
  });

  it("should keep PyPI off the scorecard and transitive branches", () => {
    const route = reviewRoute(
      report({
        packageName: "requests",
        ecosystem: "pypi",
        npm: {
          name: "requests",
          version: "2.32.3",
          description: "http",
          dependencies: { urllib3: ">=1.21.1" },
          repository: { type: "git", url: "https://github.com/psf/requests" },
        },
        security: {
          hasVulnerabilities: true,
          totalCount: 2,
          critical: 0,
          high: 0,
          moderate: 2,
          low: 0,
          vulnerabilities: [],
        },
      }),
    );
    route.advisories.should.equal(true);
    route.dependencies.should.equal(true);
    route.scorecard.should.equal(false);
    route.transitive.should.equal(false);
    route.installScripts.should.equal(false);
  });

  it("should include npm install scripts only when one runs during install", () => {
    const route = reviewRoute(
      report({
        npm: {
          name: "esbuild",
          version: "0.25.0",
          description: "bundler",
          installScripts: [{ name: "postinstall", command: "node install.js" }],
        },
      }),
    );
    route.installScripts.should.equal(true);
  });
});
