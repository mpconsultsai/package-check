import { describe, it } from "vitest";
import {
  coreDependenciesMap,
  parsePypiRequiresDist,
} from "@/lib/pypi-requires-dist";

describe("parsePypiRequiresDist", () => {
  it("should split core, conditional, and extra requirements", () => {
    const install = parsePypiRequiresDist(
      [
        "requests>=2.28",
        "colorama; sys_platform == 'win32'",
        "pytest; extra == 'dev'",
        "",
      ],
      ["docs"],
      " >=3.9 ",
    );
    install.requiresPython!.should.equal(">=3.9");
    install.core.map((dep) => dep.name).should.deep.equal(["requests"]);
    install.conditional[0].marker.should.match(/win32/);
    install.extras.dev[0].name.should.equal("pytest");
    install.providesExtra.should.deep.equal(["dev", "docs"]);
    install.extras.docs.should.deep.equal([]);
  });

  it("should be empty when there are no requirements", () => {
    const install = parsePypiRequiresDist(null, null, "  ");
    (install.requiresPython === null).should.be.true;
    install.core.should.deep.equal([]);
  });
});

describe("coreDependenciesMap", () => {
  it("should map core names to ranges", () => {
    const install = parsePypiRequiresDist(["urllib3>=1.26"], [], null);
    coreDependenciesMap(install).should.deep.equal({ urllib3: ">=1.26" });
  });
});
