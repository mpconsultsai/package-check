import { mcpAuthorized } from "@/lib/mcp/auth";
import { handleMcpRequest } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  if (!mcpAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handleMcpRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
