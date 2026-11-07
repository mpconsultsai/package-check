import { expect } from "chai";
import { describe, it } from "vitest";
import {
  normalizeNodeRuntimeVersion,
  parseNodeRuntimeVersion,
} from "./node-runtime-pref";

describe("parseNodeRuntimeVersion", () => {
  it("accepts empty and bare majors/minors/patches", () => {
    expect(parseNodeRuntimeVersion("")).to.deep.equal({ ok: true, value: "" });
    expect(parseNodeRuntimeVersion("  ")).to.deep.equal({ ok: true, value: "" });
    expect(parseNodeRuntimeVersion("22")).to.deep.equal({ ok: true, value: "22" });
    expect(parseNodeRuntimeVersion("v20.11")).to.deep.equal({
      ok: true,
      value: "20.11",
    });
    expect(parseNodeRuntimeVersion("22.14.0")).to.deep.equal({
      ok: true,
      value: "22.14.0",
    });
  });

  it("rejects ranges, tags, and nonsense", () => {
    expect(parseNodeRuntimeVersion(">=20").ok).to.equal(false);
    expect(parseNodeRuntimeVersion("lts").ok).to.equal(false);
    expect(parseNodeRuntimeVersion("20.x").ok).to.equal(false);
    expect(parseNodeRuntimeVersion("22.14.0-rc.1").ok).to.equal(false);
    expect(parseNodeRuntimeVersion("0.12").ok).to.equal(false);
  });
});

describe("normalizeNodeRuntimeVersion", () => {
  it("returns empty for invalid input", () => {
    expect(normalizeNodeRuntimeVersion("lts")).to.equal("");
    expect(normalizeNodeRuntimeVersion("v22.1")).to.equal("22.1");
  });
});
