import { afterEach, describe, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function mcpRequest(body: unknown, authorization?: string): Request {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/mcp", () => {
  it("should reject a request without the bearer token", async () => {
    vi.stubEnv("MCP_API_KEY", "secret-token");
    const response = await POST(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );
    response.status.should.equal(401);
  });

  it("should answer an initialize request when the bearer token matches", async () => {
    vi.stubEnv("MCP_API_KEY", "secret-token");
    const response = await POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "pkglens-test", version: "0.0.0" },
          },
        },
        "Bearer secret-token",
      ),
    );
    response.status.should.equal(200);
    const payload = (await response.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    payload.result!.serverInfo!.name!.should.equal("package-check");
  });

  it("should list the package tools", async () => {
    vi.stubEnv("MCP_API_KEY", "secret-token");
    const response = await POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        "Bearer secret-token",
      ),
    );
    response.status.should.equal(200);
    const payload = (await response.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (payload.result?.tools ?? []).map((tool) => tool.name);
    names.should.deep.equal([
      "search_packages",
      "get_package",
      "get_security",
      "get_dependencies",
      "upgrade_package",
      "analyse_package",
    ]);
  });
});
