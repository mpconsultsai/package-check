import { describe, it } from "vitest";
import {
  fingerprintNpmProjectContext,
  parseNpmProjectContext,
} from "@/lib/parse/parse-npm-project-context";

describe("parseNpmProjectContext", () => {
  it("should be empty for blank input", () => {
    const parsed = parseNpmProjectContext("  ");
    parsed.source.should.equal("empty");
    parsed.packageCount.should.equal(0);
    (parsed.enginesNode === null).should.equal(true);
  });

  it("should keep package.json ranges and engines.node", () => {
    const parsed = parseNpmProjectContext(
      JSON.stringify({
        engines: { node: ">=18" },
        dependencies: { react: "^19.0.0", lodash: "^4.17.21" },
        devDependencies: { typescript: "^5.0.0" },
        peerDependencies: { react: ">=18" },
      }),
    );
    parsed.source.should.equal("package.json");
    parsed.enginesNode!.should.equal(">=18");
    parsed.deps.react.should.equal("^19.0.0");
    parsed.deps.typescript.should.equal("^5.0.0");
    parsed.packageCount.should.equal(3);
  });

  it("should read package-lock packages as resolved versions", () => {
    const parsed = parseNpmProjectContext(
      JSON.stringify({
        name: "app",
        lockfileVersion: 3,
        packages: {
          "": { engines: { node: ">=20" } },
          "node_modules/react": { version: "19.0.0" },
          "node_modules/lodash": { version: "4.17.21" },
        },
      }),
    );
    parsed.source.should.equal("package-lock");
    parsed.enginesNode!.should.equal(">=20");
    parsed.deps.react.should.equal("19.0.0");
    parsed.deps.lodash.should.equal("4.17.21");
  });

  it("should fingerprint stably regardless of key order", () => {
    const a = fingerprintNpmProjectContext(
      { b: "1", a: "2" },
      ">=18",
    );
    const b = fingerprintNpmProjectContext(
      { a: "2", b: "1" },
      ">=18",
    );
    a.should.equal(b);
  });

  it("should let npm overrides win over declared dependency ranges", () => {
    const parsed = parseNpmProjectContext(
      JSON.stringify({
        dependencies: { react: "^17.0.0", lodash: "^4.17.0" },
        overrides: {
          react: "18.2.0",
          "lodash@4.17.0": "4.17.21",
          "@scope/pkg": { ".": "2.0.0", graphql: "^16.0.0" },
        },
      }),
    );
    parsed.deps.react.should.equal("18.2.0");
    parsed.deps.lodash.should.equal("4.17.21");
    parsed.deps["@scope/pkg"].should.equal("2.0.0");
    parsed.deps.graphql.should.equal("^16.0.0");
  });

  it("should read Yarn resolutions and pnpm.overrides", () => {
    const yarn = parseNpmProjectContext(
      JSON.stringify({
        dependencies: { leftpad: "^1.0.0" },
        resolutions: { "**/left-pad": "1.3.0", "foo/bar": "2.0.0" },
      }),
    );
    yarn.deps["left-pad"].should.equal("1.3.0");
    yarn.deps.bar.should.equal("2.0.0");

    const pnpm = parseNpmProjectContext(
      JSON.stringify({
        pnpm: { overrides: { chalk: "5.3.0" } },
      }),
    );
    pnpm.source.should.equal("package.json");
    pnpm.deps.chalk.should.equal("5.3.0");
  });
});
