import { describe, it } from "vitest";
import { EXAMPLE_PACKAGES } from "@/lib/site/example-packages";

describe("EXAMPLE_PACKAGES", () => {
  it("should offer an example for each registry", () => {
    EXAMPLE_PACKAGES.npm.should.include("react");
    EXAMPLE_PACKAGES.npm.should.include("express");
    EXAMPLE_PACKAGES.pypi.should.include("requests");
    EXAMPLE_PACKAGES.nuget.should.include("Newtonsoft.Json");
  });
});
