import { describe, it } from "vitest";
import {
  EXAMPLE_PACKAGES,
  MAVEN_POPULAR_PACKAGES,
} from "@/lib/site/example-packages";

describe("EXAMPLE_PACKAGES", () => {
  it("should offer an example for each registry", () => {
    EXAMPLE_PACKAGES.npm.should.include("react");
    EXAMPLE_PACKAGES.npm.should.include("express");
    EXAMPLE_PACKAGES.pypi.should.include("requests");
    EXAMPLE_PACKAGES.nuget.should.include("Newtonsoft.Json");
    EXAMPLE_PACKAGES.maven.should.include("com.google.guava:guava");
  });
});

describe("MAVEN_POPULAR_PACKAGES", () => {
  it("should be large enough for random Try suggestions", () => {
    MAVEN_POPULAR_PACKAGES.length.should.be.above(40);
    new Set(MAVEN_POPULAR_PACKAGES).size.should.equal(
      MAVEN_POPULAR_PACKAGES.length,
    );
  });
});
