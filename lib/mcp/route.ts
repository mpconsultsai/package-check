import { mcpAuthorized } from "@/lib/mcp/auth";
import { mcpClientKey, takeMcpRequestLimit } from "@/lib/mcp/rate-limit";

export const handleMcpRoute = async (request: Request): Promise<Response> => {
  const authorization = request.headers.get("authorization");
  if (!mcpAuthorized(authorization)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = takeMcpRequestLimit(mcpClientKey(authorization));
  if (!limited.ok) {
    return Response.json(
      { error: "Too many MCP requests. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  try {
    const { handleMcpRequest } = await import("@/lib/mcp/http");
    return await handleMcpRequest(request);
  } catch (error: unknown) {
    console.error("MCP request failed:", error);
    return Response.json({ error: "MCP request failed" }, { status: 500 });
  }
};
