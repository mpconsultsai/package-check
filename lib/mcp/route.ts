import { mcpAuthorized } from "@/lib/mcp/auth";

export async function handleMcpRoute(request: Request): Promise<Response> {
  if (!mcpAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { handleMcpRequest } = await import("@/lib/mcp/http");
    return await handleMcpRequest(request);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "MCP failed to start";
    console.error("MCP request failed:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
