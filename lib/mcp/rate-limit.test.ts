import { afterEach, describe, it } from "vitest";
import {
  mcpClientKey,
  resetMcpRateLimits,
  takeMcpAnalyseLimit,
  takeMcpRequestLimit,
  takeRateLimit,
} from "@/lib/mcp/rate-limit";

afterEach(() => {
  resetMcpRateLimits();
  delete process.env.MCP_RATE_LIMIT_PER_MIN;
  delete process.env.MCP_ANALYSE_RATE_LIMIT_PER_MIN;
});

describe("mcpClientKey", () => {
  it("should hash a bearer token without returning the secret", () => {
    const key = mcpClientKey("Bearer super-secret-token");
    key.should.have.length(24);
    key.should.not.match(/secret/i);
    mcpClientKey("Bearer super-secret-token").should.equal(key);
  });

  it("should label missing auth as anonymous", () => {
    mcpClientKey(null).should.equal("anonymous");
    mcpClientKey("Token x").should.equal("anonymous");
  });
});

describe("takeRateLimit", () => {
  it("should allow traffic under the limit and block when full", () => {
    const first = takeRateLimit("t1", 2, 60_000, 1_000);
    const second = takeRateLimit("t1", 2, 60_000, 1_100);
    const third = takeRateLimit("t1", 2, 60_000, 1_200);
    first.ok.should.equal(true);
    second.ok.should.equal(true);
    third.ok.should.equal(false);
    if (!third.ok) third.retryAfterSec.should.be.greaterThan(0);
  });

  it("should free a slot after the window slides", () => {
    takeRateLimit("t2", 1, 1_000, 1_000);
    const blocked = takeRateLimit("t2", 1, 1_000, 1_100);
    blocked.ok.should.equal(false);
    const allowed = takeRateLimit("t2", 1, 1_000, 2_050);
    allowed.ok.should.equal(true);
  });
});

describe("mcp request and analyse limits", () => {
  it("should use separate buckets for requests and analyse calls", () => {
    process.env.MCP_RATE_LIMIT_PER_MIN = "2";
    process.env.MCP_ANALYSE_RATE_LIMIT_PER_MIN = "1";
    const client = "abc";
    takeMcpRequestLimit(client, 1_000).ok.should.equal(true);
    takeMcpAnalyseLimit(client, 1_000).ok.should.equal(true);
    takeMcpAnalyseLimit(client, 1_100).ok.should.equal(false);
    takeMcpRequestLimit(client, 1_100).ok.should.equal(true);
  });
});
