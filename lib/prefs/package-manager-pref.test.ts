import { describe, it } from "vitest";
import {
  formatInstallStep,
  installCommand,
  parsePackageManagerPreference,
} from "@/lib/prefs/package-manager-pref";

describe("installCommand", () => {
  it("should format npm, pnpm, yarn, and bun", () => {
    installCommand("npm", "react", "19.0.0").should.equal("npm install react@19.0.0");
    installCommand("pnpm", "react", "19.0.0").should.equal("pnpm add react@19.0.0");
    installCommand("yarn", "react", "19.0.0").should.equal("yarn add react@19.0.0");
    installCommand("bun", "react", "19.0.0").should.equal("bun add react@19.0.0");
  });
});

describe("formatInstallStep", () => {
  it("should list common managers when the preference is auto", () => {
    formatInstallStep("auto", "react", "19.0.0").should.match(/npm install/);
    formatInstallStep("pnpm", "react", "19.0.0").should.match(/pnpm add/);
  });
});

describe("parsePackageManagerPreference", () => {
  it("should accept a known manager and fall back to auto", () => {
    parsePackageManagerPreference(" Yarn ").should.equal("yarn");
    parsePackageManagerPreference("cargo").should.equal("auto");
    parsePackageManagerPreference(null).should.equal("auto");
  });
});
