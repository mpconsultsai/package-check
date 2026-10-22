import { describe, it } from "vitest";
import { githubRepoUrl } from "@/scripts/render-release.cjs";

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
