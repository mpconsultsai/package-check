import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPkglensMcpServer } from "@/lib/mcp/server";

/** One stateless MCP request. JSON responses suit a single Render process. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const server = createPkglensMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
