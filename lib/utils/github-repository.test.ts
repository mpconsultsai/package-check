import { describe, it } from "vitest";
import {
  encodeDepsDevProjectId,
  githubProjectIdFromUrl,
  githubWebUrl,
} from "@/lib/utils/github-repository";

describe("githubProjectIdFromUrl", () => {
  it("should be null for a blank value", () => {
    (githubProjectIdFromUrl("  ") === null).should.be.true;
  });

  it("should read github.com and github: forms and drop .git", () => {
    githubProjectIdFromUrl(
      "https://github.com/lodash/lodash.git",
    )!.should.equal("github.com/lodash/lodash");
    githubProjectIdFromUrl("github:lodash/lodash")!.should.equal(
      "github.com/lodash/lodash",
    );
  });

  it("should be null when the url is not a GitHub repo", () => {
    (githubProjectIdFromUrl("https://gitlab.com/a/b") === null).should.be.true;
  });
});

describe("githubWebUrl", () => {
  it("should be a GitHub page for a repository url", () => {
    githubWebUrl("git+https://github.com/facebook/react.git")!.should.equal(
      "https://github.com/facebook/react",
    );
  });

  it("should be null when there is no GitHub repository", () => {
    (githubWebUrl(null) === null).should.be.true;
    (githubWebUrl("https://gitlab.com/a/b") === null).should.be.true;
  });
});

describe("encodeDepsDevProjectId", () => {
  it("should encode the project id", () => {
    encodeDepsDevProjectId("github.com/lodash/lodash").should.equal(
      "github.com%2Flodash%2Flodash",
    );
  });
});
