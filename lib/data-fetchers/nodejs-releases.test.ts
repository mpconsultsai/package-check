import { describe, it } from "vitest";
import {
  pickLatestNodeLts,
  stripNodeVersionPrefix,
} from "@/lib/data-fetchers/nodejs-releases";

describe("stripNodeVersionPrefix", () => {
  it("should remove a leading v", () => {
    stripNodeVersionPrefix("v26.13.0").should.equal("26.13.0");
  });
});

describe("pickLatestNodeLts", () => {
  it("should skip Current/prerelease rows and take the first LTS", () => {
    pickLatestNodeLts([
      { version: "v27.0.0-alpha.0.0.0", lts: false },
      { version: "v26.13.0", lts: "Lithium" },
      { version: "v24.11.0", lts: "Krypton" },
    ])!.should.equal("26.13.0");
  });
});
