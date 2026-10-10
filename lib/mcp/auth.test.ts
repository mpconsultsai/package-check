import { afterEach, describe, it, vi } from "vitest";
import { mcpAuthorized } from "@/lib/mcp/auth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mcpAuthorized", () => {
  it("should reject every request when MCP_API_KEY is unset", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("MCP_API_KEY", "");
    mcpAuthorized("Bearer secret").should.be.false;
    (mcpAuthorized(null) === false).should.be.true;
  });

  it("should accept the matching bearer token", () => {
    vi.stubEnv("MCP_API_KEY", "secret-token");
    mcpAuthorized("Bearer secret-token").should.be.true;
    mcpAuthorized("bearer secret-token").should.be.true;
  });

  it("should reject a different token or a missing scheme", () => {
    vi.stubEnv("MCP_API_KEY", "secret-token");
    mcpAuthorized("Bearer other-token").should.be.false;
    mcpAuthorized("secret-token").should.be.false;
    mcpAuthorized(null).should.be.false;
  });
});
