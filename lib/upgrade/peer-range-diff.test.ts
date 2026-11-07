import { expect } from "chai";
import { describe, it } from "vitest";
import {
  addedPeerRangeParts,
  droppedPeerRangeParts,
  formatPeerChangeLine,
  peerRangePartLabel,
  summarizePeerRangeChange,
} from "./peer-range-diff";

describe("peer-range-diff", () => {
  it("should detect a dropped GraphQL 15 clause", () => {
    const from = "^15.2.0 || ^16.0.0 || ^17.0.0";
    const to = "^16.0.0 || ^17.0.0";
    expect(droppedPeerRangeParts(from, to)).to.deep.equal(["^15.2.0"]);
    expect(addedPeerRangeParts(from, to)).to.deep.equal([]);
    expect(peerRangePartLabel("^15.2.0")).to.equal("15.x");

    const summary = summarizePeerRangeChange(from, to);
    summary.detail.should.match(/drops \^15\.2\.0/);
    summary.detail.should.match(/15\.x no longer accepted/);
    summary.detail.should.match(/\^16\.0\.0 \|\| \^17\.0\.0/);
  });

  it("should format peer change lines for the agent brief", () => {
    formatPeerChangeLine({
      kind: "changed",
      name: "graphql",
      from: "^15.2.0 || ^16.0.0 || ^17.0.0",
      to: "^16.0.0 || ^17.0.0",
    }).should.match(/graphql: drops \^15\.2\.0/);
  });

  it("should describe a narrowed single range", () => {
    const summary = summarizePeerRangeChange(">=10", ">=18");
    summary.narrowed.should.equal(true);
    summary.detail.should.match(/narrowed >=10 → >=18/);
  });
});
