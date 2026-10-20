import { describe, it } from "vitest";
import {
  classifyNpmModuleFormat,
  definitelyTypedPackageName,
  isNpmTypesPackage,
  npmMaintainerGithubUrl,
  npmMaintainerNames,
  npmTypesIncluded,
  publishedTypesPresent,
  topBundleModules,
  typesPackageTarget,
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

describe("types package names", () => {
  it("should name the package an @types package supports", () => {
    (typesPackageTarget("@types/express") ?? "").should.equal("express");
    (typesPackageTarget("@types/babel__core") ?? "").should.equal("@babel/core");
    (typesPackageTarget("express") === null).should.equal(true);
  });

  it("should recognise a DefinitelyTyped package name", () => {
    isNpmTypesPackage("@types/react").should.equal(true);
    isNpmTypesPackage(" @TYPES/node ").should.equal(true);
    isNpmTypesPackage("react").should.equal(false);
  });

  it("should name the DefinitelyTyped package for a runtime package", () => {
    (definitelyTypedPackageName("react") ?? "").should.equal("@types/react");
    (definitelyTypedPackageName("@babel/core") ?? "").should.equal(
      "@types/babel__core",
    );
    (definitelyTypedPackageName("@types/node") === null).should.equal(true);
  });

  it("should treat a published declaration as included types", () => {
    publishedTypesPresent(["index.js", "dist/index.d.ts"]).should.equal(true);
    publishedTypesPresent(["index.js", "cjs/react.development.js"]).should.equal(
      false,
    );
    publishedTypesPresent(["test/index.d.ts", "docs/api.d.ts"]).should.equal(
      false,
    );
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
  it("should keep modules that are at least 1 percent of the approximate sizes", () => {
    const modules = topBundleModules([
      { name: "iconv-lite", approximateSize: 470 },
      { name: "mime-db", approximateSize: 260 },
      { name: "qs", approximateSize: 30 },
      { name: "tiny", approximateSize: 5 },
    ]);
    modules.map((mod) => mod.name).should.deep.equal([
      "iconv-lite",
      "mime-db",
      "qs",
    ]);
    modules[0].share.should.be.below(1);
  });

  it("should list the whole mix when one module is most of the bundle", () => {
    const modules = topBundleModules([
      { name: "yup", approximateSize: 77314 },
      { name: "tiny-case", approximateSize: 2388 },
      { name: "property-expr", approximateSize: 1439 },
      { name: "toposort", approximateSize: 1042 },
    ]);
    modules.map((mod) => mod.name).should.deep.equal([
      "yup",
      "tiny-case",
      "property-expr",
      "toposort",
    ]);
    Math.round(modules[0].share * 100).should.equal(94);
    modules.every((mod) => mod.share <= 1).should.equal(true);
  });

  it("should return nothing when no module has a size", () => {
    topBundleModules([{ name: "qs", approximateSize: 0 }]).should.deep.equal([]);
    topBundleModules(null).should.deep.equal([]);
  });
});
