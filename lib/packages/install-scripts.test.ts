import { describe, it } from "vitest";
import { listInstallScripts } from "@/lib/packages/install-scripts";

describe("listInstallScripts", () => {
  it("should keep only the scripts that run during install", () => {
    listInstallScripts({
      test: "vitest",
      preinstall: " node check.js ",
      postinstall: "node scripts/install.js",
      build: "tsc",
    }).should.deep.equal([
      { name: "preinstall", command: "node check.js" },
      { name: "postinstall", command: "node scripts/install.js" },
    ]);
  });

  it("should return nothing when scripts are missing", () => {
    listInstallScripts(undefined).should.deep.equal([]);
    listInstallScripts({ install: "  " }).should.deep.equal([]);
  });
});
