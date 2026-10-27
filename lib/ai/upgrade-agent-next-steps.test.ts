import { describe, it } from "vitest";
import { normalizeNextSteps } from "@/lib/ai/upgrade-agent";

describe("normalizeNextSteps", () => {
  it("should insert an npm i step after the first review step", () => {
    const steps = normalizeNextSteps(
      ["Review the changelog for breaking changes."],
      "lodash",
      "4.18.1",
    );
    steps.should.deep.equal([
      "Review the changelog for breaking changes.",
      "Install the target version: `npm i lodash@4.18.1`",
    ]);
  });

  it("should rewrite pnpm or yarn install lines to npm i", () => {
    const steps = normalizeNextSteps(
      [
        "Read the migration guide.",
        "pnpm add lodash@4.18.1",
        "Run the test suite.",
      ],
      "lodash",
      "4.18.1",
    );
    steps[1].should.equal("Install the target version: `npm i lodash@4.18.1`");
  });
});
