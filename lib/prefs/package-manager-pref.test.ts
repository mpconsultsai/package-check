import { describe, it } from "vitest";
import {
  formatNpmInstallStep,
  npmInstallCommand,
} from "@/lib/prefs/package-manager-pref";

describe("npmInstallCommand", () => {
  it("should format npm i with the package and version", () => {
    npmInstallCommand("react", "19.0.0").should.equal("npm i react@19.0.0");
  });
});

describe("formatNpmInstallStep", () => {
  it("should wrap the npm i command for upgrade next steps", () => {
    formatNpmInstallStep("react", "19.0.0").should.equal(
      "Install the target version: `npm i react@19.0.0`",
    );
  });
});
