import { describe, it } from "vitest";
import {
  classifyNpmModuleFormat,
  npmMaintainerGithubUrl,
  npmMaintainerNames,
  npmTypesIncluded,
  topBundleModules,
} from "@/lib/packages/npm-package-facts";

describe("classifyNpmModuleFormat", () => {
  it("should treat a package with no module fields as CommonJS", () => {
    classifyNpmModuleFormat({ main: "index.js" }).should.equal("cjs");
  });

  it("should treat type module as ESM", () => {
    classifyNpmModuleFormat({ type: "module", main: "index.js" }).should.equal(
      "esm",
    );
  });

  it("should treat import and require exports as both", () => {
    classifyNpmModuleFormat({
      exports: { ".": { import: "./index.mjs", require: "./index.cjs" } },
    }).should.equal("dual");
  });

  it("should treat a module field next to main as both", () => {
    classifyNpmModuleFormat({
      main: "index.js",
      module: "index.mjs",
    }).should.equal("dual");
  });
});

describe("npmTypesIncluded", () => {
  it("should be true when types or typings is set", () => {
    npmTypesIncluded({ types: "index.d.ts" }).should.equal(true);
    npmTypesIncluded({ typings: "index.d.ts" }).should.equal(true);
  });

  it("should be true when exports declare a types condition", () => {
    npmTypesIncluded({
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
    }).should.equal(true);
  });

  it("should be false when nothing declares types", () => {
    npmTypesIncluded({}).should.equal(false);
  });
});

describe("npmMaintainerNames", () => {
  it("should keep unique names and drop blanks", () => {
    npmMaintainerNames([
      { name: "Ada" },
      { name: " ada " },
      { name: "" },
      { name: "Grace" },
    ]).should.deep.equal(["Ada", "Grace"]);
  });

  it("should link a maintainer name to GitHub", () => {
    npmMaintainerGithubUrl("wesleytodd").should.equal(
      "https://github.com/wesleytodd",
    );
  });
});

describe("topBundleModules", () => {
  it("should keep the modules that take at least 5 percent", () => {
    topBundleModules(
      [
        { name: "iconv-lite", approximateSize: 470 },
        { name: "mime-db", approximateSize: 260 },
        { name: "qs", approximateSize: 30 },
        { name: "tiny", approximateSize: 5 },
      ],
      1000,
    ).map((mod) => mod.name).should.deep.equal(["iconv-lite", "mime-db"]);
  });

  it("should return nothing when the total size is missing", () => {
    topBundleModules([{ name: "qs", approximateSize: 10 }], 0).should.deep.equal(
      [],
    );
  });
});
