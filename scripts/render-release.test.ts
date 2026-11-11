import { afterEach, describe, it } from "vitest";
import {
  githubRepoUrl,
  releaseRepoUrl,
  shouldSkipRelease,
} from "@/scripts/render-release.cjs";

afterEach(() => {
  delete process.env.SKIP_RELEASE;
});

describe("githubRepoUrl", () => {
  it("should read an ssh remote", () => {
    (githubRepoUrl("git@github.com:mpconsultsai/package-check.git") ?? "").should.equal(
      "https://github.com/mpconsultsai/package-check",
    );
  });

  it("should read an https remote and drop any existing token", () => {
    (
      githubRepoUrl(
        "https://x-access-token:secret@github.com/mpconsultsai/package-check.git",
      ) ?? ""
    ).should.equal("https://github.com/mpconsultsai/package-check");
  });

  it("should reject a remote that is not on GitHub", () => {
    (githubRepoUrl("https://gitlab.com/acme/package-check.git") === null).should.equal(
      true,
    );
  });
});

describe("releaseRepoUrl", () => {
  it("should use the Render repo slug when the checkout has no origin", () => {
    (releaseRepoUrl("", "mpconsultsai/package-check") ?? "").should.equal(
      "https://github.com/mpconsultsai/package-check",
    );
  });
});

describe("shouldSkipRelease", () => {
  it("should skip when SKIP_RELEASE is set", () => {
    process.env.SKIP_RELEASE = "true";
    (shouldSkipRelease("feat: something") ?? "").should.match(/SKIP_RELEASE/);
  });

  it("should skip when HEAD is already a release commit", () => {
    (shouldSkipRelease("v0.1.28 [skip render]") ?? "").should.match(
      /already a release commit/,
    );
  });

  it("should run release-it for a normal commit", () => {
    (shouldSkipRelease("fix: activity lists") === null).should.equal(true);
  });
});
